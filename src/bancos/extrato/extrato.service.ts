import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContasReceberService } from '../../financeiro/contas-receber.service';
import { ContasPagarService } from '../../financeiro/contas-pagar.service';
import { lerOfx } from './ofx.parser';
import { sugerir, decidirAuto, TituloCandidato, Sugestao } from './conciliacao.util';

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

    // O que já está aqui (a trava anti-duplicata, conferida antes de escrever).
    const fitids = ofx.lancamentos.map((l) => l.fitid);
    const jaTem = new Set(
      (await this.prisma.extratoLancamento.findMany({
        where: { contaBancariaId: conta.id, fitid: { in: fitids } },
        select: { fitid: true },
      })).map((x) => x.fitid),
    );
    const novos = ofx.lancamentos.filter((l) => !jaTem.has(l.fitid));

    const imp = await this.prisma.extratoImportacao.create({
      data: {
        empresaId, contaBancariaId: conta.id,
        nomeArquivo: (dto.nomeArquivo || 'extrato.ofx').slice(0, 200),
        formato: 'ofx',
        periodoIni: ofx.periodoIni, periodoFim: ofx.periodoFim,
        saldoArquivo: ofx.saldo != null ? new Prisma.Decimal(ofx.saldo.toFixed(2)) : null,
        saldoEm: ofx.saldoEm,
        qtdLidos: ofx.lancamentos.length, qtdNovos: novos.length, qtdDuplicados: ofx.lancamentos.length - novos.length,
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

    const auto = dto.conciliarAuto === false ? { conciliados: 0, baixados: [] as string[] } : await this.conciliarAutomatico(empresaId, imp.id, usuario);
    if (auto.conciliados) {
      await this.prisma.extratoImportacao.update({ where: { id: imp.id }, data: { qtdConciliados: auto.conciliados } });
    }

    await this.prisma.log.create({
      data: {
        usuario, acao: 'extrato.importado',
        detalhe: `${conta.banco} ${conta.conta ?? ''}: ${ofx.lancamentos.length} lido(s), ${novos.length} novo(s), `
          + `${ofx.lancamentos.length - novos.length} já estavam, ${auto.conciliados} conciliado(s) automaticamente`,
        entidade: 'ExtratoImportacao', entidadeId: String(imp.id),
      },
    }).catch(() => undefined);

    return {
      importacaoId: imp.id,
      conta: `${conta.banco}${conta.conta ? ' · ' + conta.conta : ''}`,
      periodo: { de: ofx.periodoIni, ate: ofx.periodoFim },
      saldoBanco: ofx.saldo,
      lidos: ofx.lancamentos.length,
      novos: novos.length,
      duplicados: ofx.lancamentos.length - novos.length,
      conciliadosAuto: auto.conciliados,
      baixados: auto.baixados,
    };
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
    if (tipo === 'receber') await this.receber.baixar(tituloId, empresaId, valor, 0, true);
    else await this.pagar.baixar(tituloId, empresaId, valor, `Extrato ${l.data.toISOString().slice(0, 10)}`, 0, true);

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
