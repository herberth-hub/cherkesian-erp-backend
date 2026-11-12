import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContasReceberService } from '../../financeiro/contas-receber.service';
import { ContasPagarService } from '../../financeiro/contas-pagar.service';
import { lerOfx } from './ofx.parser';
import { sugerir, decidirAuto, TituloCandidato, Sugestao } from './conciliacao.util';
import { ExtratoDoBanco, FonteExtratoApi } from './fontes/extrato-fonte';
import {
  CoraFonte, credenciaisDoAmbiente, nomesDasVariaveis, oQueFalta,
  temCredencialPropria, validadeDoCertificado,
} from './fontes/cora.fonte';
import { soDigitos } from './fontes/cora.traducao';

/**
 * ESPELHO DO BANCO — o extrato do banco dentro do ERP, conciliado com os títulos.
 *
 * Até aqui o financeiro do sistema era uma promessa: títulos que DEVERIAM ter
 * sido pagos. O banco é o fato. Enquanto os dois não se olham, ninguém sabe se
 * o que está em aberto na tela é dinheiro que falta mesmo entrar ou dinheiro
 * que já entrou e ninguém deu baixa.
 *
 * O caminho é sempre o mesmo, venha o extrato de um arquivo OFX (hoje, qualquer
 * banco, sem convênio) ou de uma API (depois): vira `ExtratoLancamento` e passa
 * pela conciliação. A API muda a fonte, não a mecânica.
 */
@Injectable()
export class ExtratoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receber: ContasReceberService,
    private readonly pagar: ContasPagarService,
  ) {}

  /** Teto do que o sistema baixa sozinho numa importação, p/ um extrato anual não virar uma enxurrada de baixas. */
  private static readonly MAX_AUTO = 200;

  /**
   * Importa um extrato OFX.
   *
   * Duas travas sustentam o espelho:
   *  1. a unique (conta, fitid) no banco — reimportar o mesmo arquivo não
   *     duplica dinheiro: o que já está aqui é contado como duplicado e ignorado;
   *  2. a conferência de conta/agência — extrato da conta errada entraria
   *     silenciosamente e misturaria o dinheiro de dois CNPJs.
   */
  async importar(
    dto: { contaBancariaId: number; nomeArquivo?: string; conteudo: string; confirmarContaDiferente?: boolean; conciliarAuto?: boolean },
    empresaId: number,
    usuario: string,
  ) {
    const conta = await this.prisma.contaBancaria.findFirst({ where: { id: dto.contaBancariaId, empresaId } });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada.');

    let ofx;
    try { ofx = lerOfx(dto.conteudo); } catch (e) { throw new BadRequestException((e as Error).message); }

    // Conta do arquivo x conta escolhida. Só compara dígito com dígito: o banco
    // escreve a conta com e sem DV, com e sem zero à esquerda.
    const so = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
    const contaArq = so(ofx.conta);
    const contaSis = so(conta.conta);
    if (!dto.confirmarContaDiferente && contaArq && contaSis && contaArq !== contaSis) {
      throw new BadRequestException(
        `O extrato é da conta ${ofx.conta} e você escolheu a conta ${conta.conta} (${conta.banco}). ` +
        'Importar assim misturaria o dinheiro de duas contas. Escolha a conta certa — ou confirme que é a mesma conta com outro número.',
      );
    }

    return this.gravar(conta, ofx, { formato: 'ofx', nome: dto.nomeArquivo || 'extrato.ofx' }, empresaId, usuario, dto.conciliarAuto !== false);
  }

  /**
   * Grava a janela de extrato e concilia. É o caminho ÚNICO: OFX e API passam
   * os dois por aqui, para que trocar a fonte não mude nem o que a tela mostra
   * nem como a baixa é decidida.
   */
  private async gravar(
    conta: { id: number; banco: string; conta: string | null },
    extrato: ExtratoDoBanco,
    origem: { formato: 'ofx' | 'api'; nome: string },
    empresaId: number,
    usuario: string,
    conciliarAuto: boolean,
  ) {
    // O que já está aqui (a trava anti-duplicata, conferida antes de escrever).
    const fitids = extrato.lancamentos.map((l) => l.fitid);
    const jaTem = new Set(
      (await this.prisma.extratoLancamento.findMany({
        where: { contaBancariaId: conta.id, fitid: { in: fitids } },
        select: { fitid: true },
      })).map((x) => x.fitid),
    );
    const novos = extrato.lancamentos.filter((l) => !jaTem.has(l.fitid));

    const imp = await this.prisma.extratoImportacao.create({
      data: {
        empresaId, contaBancariaId: conta.id,
        nomeArquivo: origem.nome.slice(0, 200),
        formato: origem.formato,
        periodoIni: extrato.periodoIni, periodoFim: extrato.periodoFim,
        saldoArquivo: extrato.saldo != null ? new Prisma.Decimal(extrato.saldo.toFixed(2)) : null,
        saldoEm: extrato.saldoEm,
        qtdLidos: extrato.lancamentos.length, qtdNovos: novos.length, qtdDuplicados: extrato.lancamentos.length - novos.length,
        importadoPor: usuario,
      },
      select: { id: true },
    });

    if (novos.length) {
      // Uma escrita para o lote inteiro — o Neon é pooled.
      await this.prisma.extratoLancamento.createMany({
        data: novos.map((l) => ({
          empresaId, contaBancariaId: conta.id, importacaoId: imp.id,
          data: l.data, valor: new Prisma.Decimal(l.valor.toFixed(2)), tipo: l.tipo,
          descricao: l.descricao, documento: l.documento, fitid: l.fitid,
        })),
        skipDuplicates: true,
      });
    }

    const auto = conciliarAuto ? await this.conciliarAutomatico(empresaId, imp.id, usuario) : { conciliados: 0, baixados: [] as string[] };
    if (auto.conciliados) {
      await this.prisma.extratoImportacao.update({ where: { id: imp.id }, data: { qtdConciliados: auto.conciliados } });
    }

    await this.prisma.log.create({
      data: {
        usuario, acao: origem.formato === 'api' ? 'extrato.importado.api' : 'extrato.importado',
        detalhe: `${conta.banco} ${conta.conta ?? ''}: ${extrato.lancamentos.length} lido(s), ${novos.length} novo(s), `
          + `${extrato.lancamentos.length - novos.length} já estavam, ${auto.conciliados} conciliado(s) automaticamente`,
        entidade: 'ExtratoImportacao', entidadeId: String(imp.id),
      },
    }).catch(() => undefined);

    return {
      importacaoId: imp.id,
      conta: `${conta.banco}${conta.conta ? ' · ' + conta.conta : ''}`,
      periodo: { de: extrato.periodoIni, ate: extrato.periodoFim },
      saldoBanco: extrato.saldo ?? null,
      lidos: extrato.lancamentos.length,
      novos: novos.length,
      duplicados: extrato.lancamentos.length - novos.length,
      conciliadosAuto: auto.conciliados,
      baixados: auto.baixados,
    };
  }

  /**
   * Puxa o extrato pela API do banco — sem ninguém baixar arquivo nenhum.
   *
   * A janela padrão são os últimos 7 dias, e não só "ontem": lançamento que o
   * banco registra com atraso (PIX de fim de semana, estorno) entraria uma vez
   * só e nunca mais seria procurado. Reimportar a mesma janela é de graça — a
   * trava do fitid cuida disso.
   */
  async importarDaApi(
    dto: { contaBancariaId: number; dias?: number; de?: string; ate?: string; conciliarAuto?: boolean },
    empresaId: number,
    usuario: string,
  ) {
    const conta = await this.prisma.contaBancaria.findFirst({
      where: { id: dto.contaBancariaId, empresaId },
      include: { filial: { select: { cnpj: true, nome: true } } },
    });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada.');
    const fonte = this.fonteDaConta(conta);

    const ate = dto.ate ? new Date(dto.ate + 'T00:00:00Z') : new Date();
    const dias = Math.min(Math.max(Number(dto.dias ?? 7), 1), 90);
    const de = dto.de ? new Date(dto.de + 'T00:00:00Z') : new Date(ate.getTime() - dias * 86_400_000);
    if (de > ate) throw new BadRequestException('A data inicial é depois da final.');

    const extrato = await fonte.buscar(de, ate);

    // DE QUEM É ESSA CONTA? Uma credencial de API atende UMA conta, e a tela
    // oferece todas as do banco. Sem esta conferência, puxar com a conta errada
    // selecionada arquivaria o dinheiro de um CNPJ debaixo de outro — e o erro
    // só apareceria no fechamento, quando ninguém mais lembra do clique.
    // O CNPJ da conta é o `cedenteDocumento` quando ele existe (conta de filial
    // com CNPJ próprio); senão é o da filial.
    const doBanco = soDigitos(extrato.titularDocumento);
    const doCadastro = soDigitos(conta.cedenteDocumento || conta.filial?.cnpj);
    if (doBanco && doCadastro && doBanco !== doCadastro) {
      throw new BadRequestException(
        `Esta credencial abre a conta de ${extrato.titularNome ?? 'outro CNPJ'} (${doBanco}), ` +
        `e você escolheu a conta ${conta.banco}${conta.conta ? ' ' + conta.conta : ''} de ${conta.filial?.nome ?? ''} (${doCadastro}). ` +
        'Importar assim misturaria o dinheiro de dois CNPJs. Escolha a conta certa — ou cadastre a credencial desta conta.',
      );
    }

    // O SALDO DO ESPELHO VEM DO ENDPOINT DE SALDO, não do fim do extrato.
    // Numa janela sem movimento o extrato devolve saldo zero (visto na conta
    // real: extrato dizia R$ 0,00 e a conta tinha R$ 0,84) — e a tela mostraria
    // "saldo no banco: R$ 0,00", que é pior que não mostrar nada. Se a consulta
    // de saldo falhar, fica o do extrato: o espelho não cai por causa dela.
    try {
      const agora = await fonte.saldo();
      if (agora != null) { extrato.saldo = agora; extrato.saldoEm = new Date(); }
    } catch { /* mantém o saldo declarado no extrato */ }

    const nome = `${fonte.nome} API · ${de.toISOString().slice(0, 10)} a ${ate.toISOString().slice(0, 10)}`;
    return this.gravar(conta, extrato, { formato: 'api', nome }, empresaId, usuario, dto.conciliarAuto !== false);
  }

  /**
   * Testa a conexão sem gravar nada — é o que a tela chama depois que as
   * credenciais entram no Render, para dizer "conectado" ou dizer exatamente
   * o que falta.
   */
  async testarApi(contaBancariaId: number, empresaId: number) {
    const conta = await this.prisma.contaBancaria.findFirst({
      where: { id: contaBancariaId, empresaId },
      include: { filial: { select: { cnpj: true, nome: true } } },
    });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada.');
    const fonte = this.fonteDaConta(conta);
    const cnpj = conta.cedenteDocumento || conta.filial?.cnpj || null;

    const saldo = await fonte.saldo();
    // Além do saldo, o teste PROVA de quem é a conta que a credencial abriu:
    // uma janela mínima traz o CNPJ do titular. Sem isso, um certificado
    // trocado entre contas passaria no teste e só erraria na importação.
    let titular: { documento: string | null; nome: string | null } = { documento: null, nome: null };
    try {
      const hoje = new Date();
      const amostra = await fonte.buscar(new Date(hoje.getTime() - 86_400_000), hoje);
      titular = { documento: amostra.titularDocumento ?? null, nome: amostra.titularNome ?? null };
    } catch { /* o saldo já provou que conecta; o titular é um extra */ }

    const esperado = soDigitos(cnpj);
    const recebido = soDigitos(titular.documento);
    const confere = !esperado || !recebido ? null : esperado === recebido;

    const cred = credenciaisDoAmbiente(process.env, cnpj);
    const val = cred ? validadeDoCertificado(cred.certPem) : null;
    return {
      ok: confere !== false,
      banco: fonte.nome,
      conta: `${conta.banco}${conta.conta ? ' · ' + conta.conta : ''}`,
      saldo,
      titularNome: titular.nome,
      titularDocumento: recebido || null,
      cnpjCadastrado: esperado || null,
      confere,
      propria: temCredencialPropria(process.env, cnpj),
      credencialVence: val?.vence ?? null,
      credencialDias: val?.diasRestantes ?? null,
      credencialPerto: val?.perto ?? false,
    };
  }

  /**
   * O que falta para cada conta do Cora virar automática — é o que a tela
   * mostra para o Herberth saber exatamente quais variáveis criar no Render.
   */
  async statusApi(empresaId: number) {
    const contas = await this.prisma.contaBancaria.findMany({
      where: { empresaId, ativa: true },
      include: { filial: { select: { nome: true, cnpj: true } } },
      orderBy: { id: 'asc' },
    });
    return contas
      .filter((c) => String(c.codigoBanco ?? '') === '403' || /cora/i.test(c.banco))
      .map((c) => {
        const cnpj = c.cedenteDocumento || c.filial?.cnpj || null;
        const faltando = oQueFalta(process.env, cnpj);
        return {
          id: c.id,
          conta: `${c.banco}${c.conta ? ' · ' + c.conta : ''}${c.contaDv ? '-' + c.contaDv : ''}`,
          apelido: c.apelido,
          empresa: c.filial?.nome ?? null,
          cnpj,
          variaveis: nomesDasVariaveis(cnpj),
          configurada: faltando.length === 0,
          propria: temCredencialPropria(process.env, cnpj),
          faltando,
        };
      });
  }

  /**
   * Qual API atende esta conta. Hoje só o Cora — Santander e Bradesco entram
   * aqui quando o convênio sair, sem mexer em mais nada.
   */
  private fonteDaConta(conta: {
    banco: string; codigoBanco: string | null; apiAmbiente: string | null;
    cedenteDocumento?: string | null; conta?: string | null;
    filial?: { cnpj: string | null } | null;
  }): FonteExtratoApi {
    const ehCora = String(conta.codigoBanco ?? '') === '403' || /cora/i.test(conta.banco);
    if (!ehCora) {
      throw new BadRequestException(
        `Ainda não existe API de extrato para ${conta.banco}. Hoje a importação automática é só do Cora — ` +
        'para os outros bancos, use "Importar extrato (OFX)" enquanto o convênio não sai.',
      );
    }
    // Cada conta do Cora tem credencial própria — a desta é procurada pelo
    // CNPJ do titular, e o padrão sem CNPJ atende a primeira que foi ligada.
    const cnpj = conta.cedenteDocumento || conta.filial?.cnpj || null;
    const cred = credenciaisDoAmbiente(process.env, cnpj);
    if (!cred) {
      throw new BadRequestException(
        `A conta ${conta.banco}${conta.conta ? ' ' + conta.conta : ''} ainda não tem credencial de API. ` +
        'Cadastre no Render: ' + oQueFalta(process.env, cnpj).join(', ') +
        '. Gere a credencial no Cora Web trocando para ESTA conta antes de entrar em Integrações via APIs.',
      );
    }
    return new CoraFonte({ ...cred, ambiente: conta.apiAmbiente ?? cred.ambiente });
  }

  /** Títulos em aberto que podem casar com um extrato — uma leitura só. */
  private async candidatos(empresaId: number): Promise<TituloCandidato[]> {
    const [rec, pag] = await Promise.all([
      this.prisma.contaReceber.findMany({
        where: { empresaId, status: { not: 'pago' } },
        select: { id: true, valor: true, pago: true, vencimento: true, documento: true, clienteId: true, pedidoId: true },
      }),
      this.prisma.contaPagar.findMany({
        where: { empresaId, status: { not: 'pago' } },
        select: { id: true, valor: true, pago: true, vencimento: true, referencia: true, fornecedorId: true, categoria: true },
      }),
    ]);
    const cliIds = [...new Set(rec.map((r) => r.clienteId))];
    const pedIds = [...new Set(rec.map((r) => r.pedidoId).filter((x): x is number => x != null))];
    const forIds = [...new Set(pag.map((p) => p.fornecedorId).filter((x): x is number => x != null))];
    const [clis, peds, fors] = await Promise.all([
      cliIds.length ? this.prisma.cliente.findMany({ where: { id: { in: cliIds } }, select: { id: true, nome: true, fantasia: true } }) : [],
      pedIds.length ? this.prisma.pedido.findMany({ where: { id: { in: pedIds } }, select: { id: true, numero: true } }) : [],
      forIds.length ? this.prisma.fornecedor.findMany({ where: { id: { in: forIds } }, select: { id: true, nome: true } }) : [],
    ]);
    const cMap = new Map(clis.map((c) => [c.id, c.fantasia || c.nome]));
    const pMap = new Map(peds.map((p) => [p.id, p.numero]));
    const fMap = new Map(fors.map((f) => [f.id, f.nome]));

    return [
      ...rec.map((r) => ({
        id: r.id, tipo: 'receber' as const,
        valor: Number(r.valor), saldo: Number(r.valor.minus(r.pago)), vencimento: r.vencimento,
        documento: r.documento, parte: cMap.get(r.clienteId) ?? null,
        pedidoNumero: r.pedidoId != null ? pMap.get(r.pedidoId) ?? null : null,
      })),
      ...pag.map((p) => ({
        id: p.id, tipo: 'pagar' as const,
        valor: Number(p.valor), saldo: Number(p.valor.minus(p.pago)), vencimento: p.vencimento,
        documento: p.referencia, parte: (p.fornecedorId != null ? fMap.get(p.fornecedorId) : null) ?? p.categoria,
        pedidoNumero: null,
      })),
    ].filter((t) => t.saldo > 0);
  }

  /**
   * Casa sozinho o que for inequívoco (ver `decidirAuto`) e dá baixa no título.
   * Um título só é usado uma vez na mesma rodada — dois créditos iguais não
   * podem quitar o mesmo título duas vezes.
   */
  private async conciliarAutomatico(empresaId: number, importacaoId: number, usuario: string) {
    const pendentes = await this.prisma.extratoLancamento.findMany({
      where: { empresaId, importacaoId, status: 'pendente' },
      orderBy: { data: 'asc' },
    });
    if (!pendentes.length) return { conciliados: 0, baixados: [] as string[] };

    const cands = await this.candidatos(empresaId);
    const usados = new Set<string>();
    const baixados: string[] = [];
    let conciliados = 0;

    for (const l of pendentes) {
      if (conciliados >= ExtratoService.MAX_AUTO) break;
      const lanc = { data: l.data, valor: Number(l.valor), tipo: l.tipo as 'credito' | 'debito', descricao: l.descricao, documento: l.documento };
      const livres = cands.filter((c) => !usados.has(`${c.tipo}:${c.id}`));
      const escolha = decidirAuto(lanc, sugerir(lanc, livres), livres);
      if (!escolha) continue;
      try {
        await this.aplicar(l.id, escolha.tipo, escolha.tituloId, empresaId, usuario, true, escolha.motivos);
        usados.add(`${escolha.tipo}:${escolha.tituloId}`);
        conciliados++;
        baixados.push(`${escolha.tipo === 'receber' ? 'R' : 'P'}#${escolha.tituloId} · R$ ${Number(l.valor).toFixed(2)}`);
      } catch { /* um que não deu não pode derrubar a importação inteira */ }
    }
    return { conciliados, baixados };
  }

  /** Conciliação manual: a pessoa escolheu o título na tela. */
  async conciliar(
    lancamentoId: number,
    dto: { contaReceberId?: number; contaPagarId?: number },
    empresaId: number,
    usuario: string,
  ) {
    const tipo = dto.contaReceberId ? 'receber' as const : dto.contaPagarId ? 'pagar' as const : null;
    const tituloId = dto.contaReceberId ?? dto.contaPagarId;
    if (!tipo || !tituloId) throw new BadRequestException('Escolha o título a conciliar.');
    return this.aplicar(lancamentoId, tipo, tituloId, empresaId, usuario, false, []);
  }

  /**
   * Liga o lançamento ao título E dá a baixa — as duas coisas, sempre juntas.
   * Conciliar sem baixar deixaria o título "em aberto" com o dinheiro já no
   * banco; baixar sem conciliar deixaria o extrato sem explicação.
   */
  private async aplicar(
    lancamentoId: number,
    tipo: 'receber' | 'pagar',
    tituloId: number,
    empresaId: number,
    usuario: string,
    auto: boolean,
    motivos: string[],
  ) {
    const l = await this.prisma.extratoLancamento.findFirst({ where: { id: lancamentoId, empresaId } });
    if (!l) throw new NotFoundException('Lançamento do extrato não encontrado.');
    if (l.status === 'conciliado') throw new BadRequestException('Este lançamento já está conciliado.');
    if ((tipo === 'receber') !== (l.tipo === 'credito')) {
      throw new BadRequestException(
        l.tipo === 'credito'
          ? 'Entrada no banco só concilia com título a RECEBER.'
          : 'Saída do banco só concilia com título a PAGAR.',
      );
    }
    const valor = Number(l.valor);

    // Baixa pelo serviço do financeiro: é ele que sabe de juros, status e da
    // comissão automática na quitação. Excedente vira juros (pagamento com
    // multa por atraso é exatamente o caso que aparece no extrato).
    // A data da baixa é a DO EXTRATO, não a de hoje: foi o banco que disse em
    // que dia o dinheiro se moveu, e é por esse dia que a conferência fecha.
    if (tipo === 'receber') await this.receber.baixar(tituloId, empresaId, valor, 0, true, l.data);
    else await this.pagar.baixar(tituloId, empresaId, valor, `Extrato ${l.data.toISOString().slice(0, 10)}`, 0, true, l.data);

    const upd = await this.prisma.extratoLancamento.update({
      where: { id: l.id },
      data: {
        status: 'conciliado',
        contaReceberId: tipo === 'receber' ? tituloId : null,
        contaPagarId: tipo === 'pagar' ? tituloId : null,
        conciliadoEm: new Date(), conciliadoPor: usuario, conciliadoAuto: auto,
      },
    });
    await this.prisma.log.create({
      data: {
        usuario, acao: auto ? 'extrato.conciliado.auto' : 'extrato.conciliado',
        detalhe: `${l.tipo} R$ ${valor.toFixed(2)} de ${l.data.toISOString().slice(0, 10)} (${l.descricao.slice(0, 60)}) `
          + `→ ${tipo} #${tituloId}${motivos.length ? ' · ' + motivos.join('; ') : ''}`,
        entidade: 'ExtratoLancamento', entidadeId: String(l.id),
      },
    }).catch(() => undefined);
    return { id: upd.id, status: upd.status, tipo, tituloId, valor, auto };
  }

  /** Desfaz a conciliação (não estorna a baixa — isso é decisão do financeiro). */
  async desconciliar(lancamentoId: number, empresaId: number, usuario: string) {
    const l = await this.prisma.extratoLancamento.findFirst({ where: { id: lancamentoId, empresaId } });
    if (!l) throw new NotFoundException('Lançamento do extrato não encontrado.');
    if (l.status !== 'conciliado') throw new BadRequestException('Este lançamento não está conciliado.');
    const upd = await this.prisma.extratoLancamento.update({
      where: { id: l.id },
      data: { status: 'pendente', contaReceberId: null, contaPagarId: null, conciliadoEm: null, conciliadoPor: null, conciliadoAuto: false },
    });
    await this.prisma.log.create({
      data: {
        usuario, acao: 'extrato.desconciliado',
        // A baixa NÃO volta sozinha: estornar dinheiro é decisão de gente.
        detalhe: `Lançamento ${l.id} solto do título ${l.contaReceberId ?? l.contaPagarId} — a BAIXA do título continua lançada; estorne no financeiro se for o caso.`,
        entidade: 'ExtratoLancamento', entidadeId: String(l.id),
      },
    }).catch(() => undefined);
    return { id: upd.id, status: upd.status, avisoBaixa: 'A baixa do título não foi estornada — faça isso em Contas a Receber/Pagar se necessário.' };
  }

  /** Marca como "não é título" (tarifa, IOF, transferência entre contas próprias). */
  async ignorar(lancamentoId: number, motivo: string, empresaId: number, usuario: string) {
    const l = await this.prisma.extratoLancamento.findFirst({ where: { id: lancamentoId, empresaId } });
    if (!l) throw new NotFoundException('Lançamento do extrato não encontrado.');
    if (l.status === 'conciliado') throw new BadRequestException('Lançamento conciliado — desfaça a conciliação antes.');
    const upd = await this.prisma.extratoLancamento.update({
      where: { id: l.id },
      data: { status: 'ignorado', ignoradoMotivo: (motivo || '').slice(0, 200) || 'sem título correspondente' },
    });
    return { id: upd.id, status: upd.status };
  }

  /** Sugestões de título para UM lançamento (a tela mostra ao clicar nele). */
  async sugestoes(lancamentoId: number, empresaId: number) {
    const l = await this.prisma.extratoLancamento.findFirst({ where: { id: lancamentoId, empresaId } });
    if (!l) throw new NotFoundException('Lançamento do extrato não encontrado.');
    const cands = await this.candidatos(empresaId);
    const lanc = { data: l.data, valor: Number(l.valor), tipo: l.tipo as 'credito' | 'debito', descricao: l.descricao, documento: l.documento };
    const sugs = sugerir(lanc, cands, 8);
    const porId = new Map(cands.map((c) => [`${c.tipo}:${c.id}`, c]));
    return {
      lancamento: { id: l.id, data: l.data, valor: Number(l.valor), tipo: l.tipo, descricao: l.descricao, status: l.status },
      sugestoes: sugs.map((s: Sugestao) => {
        const t = porId.get(`${s.tipo}:${s.tituloId}`)!;
        return {
          tipo: s.tipo, tituloId: s.tituloId, score: s.score, motivos: s.motivos,
          valor: t.valor, saldo: t.saldo, vencimento: t.vencimento,
          parte: t.parte, documento: t.documento, pedido: t.pedidoNumero,
        };
      }),
    };
  }

  /** Lançamentos do extrato, com filtro. */
  async listar(empresaId: number, filtro: { contaBancariaId?: number; status?: string; de?: string; ate?: string } = {}) {
    const lancs = await this.prisma.extratoLancamento.findMany({
      where: {
        empresaId,
        ...(filtro.contaBancariaId ? { contaBancariaId: filtro.contaBancariaId } : {}),
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.de || filtro.ate ? {
          data: {
            ...(filtro.de ? { gte: new Date(filtro.de + 'T00:00:00') } : {}),
            ...(filtro.ate ? { lte: new Date(filtro.ate + 'T23:59:59') } : {}),
          },
        } : {}),
      },
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 2000,
    });
    return lancs.map((l) => ({ ...l, valor: Number(l.valor) }));
  }

  /**
   * O PLACAR DO ESPELHO: o que o banco diz x o que o sistema sabe explicar.
   *
   * É o número que importa de verdade. "Pendente" não é um detalhe de tela: é
   * dinheiro que se mexeu na conta e que o ERP ainda não sabe de onde veio.
   */
  async resumo(empresaId: number, contaBancariaId?: number) {
    const contas = await this.prisma.contaBancaria.findMany({
      where: { empresaId, ...(contaBancariaId ? { id: contaBancariaId } : {}), ativa: true },
      select: { id: true, banco: true, conta: true, apelido: true },
    });
    const ids = contas.map((c) => c.id);
    if (!ids.length) return { contas: [], totais: { pendentes: 0, valorPendente: 0, conciliados: 0, ignorados: 0 } };

    const [porStatus, ultimas] = await Promise.all([
      this.prisma.extratoLancamento.groupBy({
        by: ['contaBancariaId', 'status', 'tipo'],
        where: { empresaId, contaBancariaId: { in: ids } },
        _count: { _all: true }, _sum: { valor: true },
      }),
      this.prisma.extratoImportacao.findMany({
        where: { empresaId, contaBancariaId: { in: ids } },
        orderBy: { id: 'desc' }, take: 50,
        select: { contaBancariaId: true, importadoEm: true, periodoFim: true, saldoArquivo: true, saldoEm: true },
      }),
    ]);
    const ultimaPorConta = new Map<number, (typeof ultimas)[number]>();
    for (const u of ultimas) if (!ultimaPorConta.has(u.contaBancariaId)) ultimaPorConta.set(u.contaBancariaId, u);

    const totais = { pendentes: 0, valorPendente: 0, conciliados: 0, ignorados: 0 };
    const linhas = contas.map((c) => {
      const meus = porStatus.filter((g) => g.contaBancariaId === c.id);
      const cont = (st: string) => meus.filter((g) => g.status === st).reduce((s, g) => s + g._count._all, 0);
      const soma = (st: string, tp: string) => meus.filter((g) => g.status === st && g.tipo === tp).reduce((s, g) => s + Number(g._sum.valor ?? 0), 0);
      const pend = cont('pendente');
      const u = ultimaPorConta.get(c.id);
      totais.pendentes += pend;
      totais.valorPendente += soma('pendente', 'credito') + soma('pendente', 'debito');
      totais.conciliados += cont('conciliado');
      totais.ignorados += cont('ignorado');
      return {
        contaBancariaId: c.id,
        conta: c.apelido || `${c.banco}${c.conta ? ' · ' + c.conta : ''}`,
        pendentes: pend,
        creditoPendente: soma('pendente', 'credito'),
        debitoPendente: soma('pendente', 'debito'),
        conciliados: cont('conciliado'),
        ignorados: cont('ignorado'),
        saldoBanco: u?.saldoArquivo != null ? Number(u.saldoArquivo) : null,
        saldoEm: u?.saldoEm ?? null,
        ultimaImportacao: u?.importadoEm ?? null,
        ateQuandoEspelhado: u?.periodoFim ?? null,
      };
    });
    return { contas: linhas, totais };
  }
}
