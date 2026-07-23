import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cliente, Filial, NFeStatus, NotaFiscal, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

/** Só dígitos (CNPJ/CPF/CEP/telefone). */
const digitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Integração de NF-e (SPEC §1 · módulo isolado plugado na API).
 *
 * Numeração: usa Empresa.nfeSerie + Empresa.nfeProximoNumero (para continuar
 * de onde o sistema anterior parou); incrementa a cada emissão bem-sucedida.
 *
 * Provedor: com FOCUS_NFE_TOKEN emite via Focus NFe (o emitente e o
 * certificado A1 ficam configurados no painel do provedor); sem token, gera
 * uma nota `simulada` e devolve o payload que SERIA enviado (para a
 * contabilidade revisar CST/CFOP/alíquotas antes de ir a produção).
 */
@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  listar(empresaId: number): Promise<NotaFiscal[]> {
    return this.prisma.notaFiscal.findMany({ where: { empresaId }, orderBy: { id: 'desc' } });
  }

  async emitir(expedicaoId: number, empresaId: number, usuario: string) {
    const exp = await this.prisma.expedicao.findUnique({ where: { id: expedicaoId } });
    if (!exp) throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    }
    const jaEmitida = await this.prisma.notaFiscal.findFirst({
      where: { expedicaoId, status: { in: ['pendente', 'autorizada', 'simulada'] } },
    });
    if (jaEmitida) throw new ConflictException(`Expedição já possui a nota ${jaEmitida.numero}.`);

    const pedido = exp.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true } })
      : null;
    const itens = pedido?.itens ?? [];
    const valor = pedido?.valorTotal ?? new Prisma.Decimal(0);

    // Emitente = filial do pedido; se não houver, a matriz da empresa.
    let filial = pedido?.filialId
      ? await this.prisma.filial.findUnique({ where: { id: pedido.filialId } })
      : null;
    if (!filial) filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado. Cadastre a matriz em Filiais (Config. Fiscal).');

    // Token: o da filial tem prioridade; senão, o global do ambiente.
    const token = filial.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');

    // Validação fiscal mínima só quando vai emitir DE VERDADE (com provedor).
    if (token) {
      const faltas = this.validarFiscal(filial, cliente, itens.length);
      if (faltas.length) {
        throw new BadRequestException(
          'Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.',
        );
      }
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const infoAdic = pedido?.ordemCompraCliente ? `Pedido de compra do cliente: ${pedido.ordemCompraCliente}` : undefined;
    const payload = await this.montarPayload(filial, cliente, exp, itens, serie, numeroSeq, valor, infoAdic);

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFE-${filial.id}-${serie}-${numeroSeq}`, payload)
      : this.emitirSimulada();

    // Rejeitada: não persiste nem consome número (a SEFAZ/provedor não aceitou).
    // Devolve a rejeição para o usuário corrigir (auditada pelo interceptor).
    if (emissao.status === 'rejeitada') {
      return {
        status: 'rejeitada' as const,
        numero: numeroNota,
        motivo: emissao.motivo,
        provedor: emissao.provedor,
        payloadPreview: token ? undefined : payload,
      };
    }

    const nota = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.notaFiscal.create({
        data: {
          empresaId,
          filialId: filial.id,
          expedicaoId,
          pedidoId: exp.pedidoId,
          numero: numeroNota,
          serie,
          chave: emissao.chave,
          status: emissao.status,
          protocolo: emissao.protocolo,
          motivo: emissao.motivo,
          valor,
          provedor: emissao.provedor,
          ordemCompraCliente: pedido?.ordemCompraCliente,
          emitidaPor: usuario,
        },
      });
      // pendente/simulada: consome o número da sequência DA FILIAL e vincula à expedição.
      await tx.filial.update({
        where: { id: filial.id },
        data: { nfeProximoNumero: numeroSeq + 1 },
      });
      await tx.expedicao.update({ where: { id: expedicaoId }, data: { nf: criada.numero } });
      // Financeiro: lança a conta a receber da venda (saída).
      const vencimento = new Date();
      vencimento.setHours(0, 0, 0, 0);
      await tx.contaReceber.create({
        data: { empresaId, clienteId: cliente.id, pedidoId: exp.pedidoId, valor, vencimento, status: 'a_vencer' },
      });
      return criada;
    });

    // No modo simulado, devolve o payload para conferência da contabilidade.
    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /**
   * NF-e AVULSA — emite sem expedição/pedido: escolhe o cliente e os itens
   * direto. Mesma numeração e validação fiscal da emissão normal.
   */
  async emitirAvulsa(
    dto: { clienteId: number; filialId?: number; pedidoId?: number; itens: Array<{ produtoId?: number; descricao?: string; quantidade: number; valorUnit: number }>; naturezaOperacao?: string; ordemCompraCliente?: string; volumes?: number; diasVencimento?: number },
    empresaId: number,
    usuario: string,
  ) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }

    // Emitente = filial informada (validada) ou a matriz.
    let filial = dto.filialId
      ? await this.prisma.filial.findUnique({ where: { id: dto.filialId } })
      : null;
    if (filial && filial.empresaId !== empresaId) filial = null;
    if (!filial) filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado. Cadastre a matriz em Filiais (Config. Fiscal).');

    // Resolve itens (valida produto, herda descrição/dados fiscais) e soma o total.
    const itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }> = [];
    let valor = new Prisma.Decimal(0);
    let totalQtd = 0;
    for (const it of dto.itens) {
      let descricao = it.descricao;
      if (it.produtoId) {
        const produto = await this.prisma.produto.findUnique({ where: { id: it.produtoId } });
        if (!produto || produto.empresaId !== empresaId) throw new NotFoundException(`Produto ${it.produtoId} não encontrado.`);
        descricao = descricao ?? produto.descricao;
      }
      if (!descricao) throw new BadRequestException('Cada item precisa de descrição ou de um produtoId válido.');
      const valorUnit = new Prisma.Decimal(it.valorUnit);
      valor = valor.plus(valorUnit.mul(it.quantidade));
      totalQtd += Number(it.quantidade);
      itens.push({ produtoId: it.produtoId ?? null, descricao, quantidade: it.quantidade, valorUnit });
    }

    const token = filial.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (token) {
      const faltas = this.validarFiscal(filial, cliente, itens.length);
      if (faltas.length) {
        throw new BadRequestException('Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.');
      }
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;

    // Pedido vinculado (opcional): valida e usa para avançar a etapa depois.
    let pedidoVinc: { id: number; etapa: string } | null = null;
    if (dto.pedidoId) {
      const ped = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId } });
      if (!ped || ped.empresaId !== empresaId) throw new NotFoundException(`Pedido ${dto.pedidoId} não encontrado.`);
      pedidoVinc = { id: ped.id, etapa: ped.etapa };
    }

    // Cobrança: vencimento em N dias a partir do faturamento (fatura + 1 duplicata).
    const diasV = dto.diasVencimento && dto.diasVencimento > 0 ? dto.diasVencimento : 0;
    const vencimentoData = new Date();
    vencimentoData.setHours(0, 0, 0, 0);
    vencimentoData.setDate(vencimentoData.getDate() + diasV);
    let duplicatas: Array<{ numero: string; data_vencimento: string; valor: number }> | undefined;
    let venctoTxt: string | undefined;
    if (diasV > 0) {
      const iso = vencimentoData.toISOString().slice(0, 10);
      duplicatas = [{ numero: '001', data_vencimento: iso, valor: Number(valor.toFixed(2)) }];
      venctoTxt = `Vencimento: ${iso.split('-').reverse().join('/')} (${diasV} dias)`;
    }
    const infoAdic = [
      dto.ordemCompraCliente ? `Pedido de compra do cliente: ${dto.ordemCompraCliente}` : null,
      venctoTxt,
    ].filter(Boolean).join(' | ') || undefined;

    const volumes = dto.volumes && dto.volumes > 0 ? Math.round(dto.volumes) : Math.max(1, Math.round(totalQtd));
    const payload = await this.montarPayload(filial, cliente, { pecas: Math.max(1, Math.round(totalQtd)) }, itens, serie, numeroSeq, valor, infoAdic, { volumes, duplicatas });
    if (dto.naturezaOperacao) (payload as Record<string, unknown>).natureza_operacao = dto.naturezaOperacao;

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFEAV-${filial.id}-${serie}-${numeroSeq}`, payload)
      : this.emitirSimulada();

    if (emissao.status === 'rejeitada') {
      return {
        status: 'rejeitada' as const,
        numero: numeroNota,
        motivo: emissao.motivo,
        provedor: emissao.provedor,
        payloadPreview: token ? undefined : payload,
      };
    }

    const nota = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.notaFiscal.create({
        data: {
          empresaId,
          filialId: filial.id,
          pedidoId: pedidoVinc?.id,
          numero: numeroNota,
          serie,
          chave: emissao.chave,
          status: emissao.status,
          protocolo: emissao.protocolo,
          motivo: emissao.motivo,
          valor,
          provedor: emissao.provedor,
          ordemCompraCliente: dto.ordemCompraCliente,
          emitidaPor: usuario,
        },
      });
      await tx.filial.update({ where: { id: filial.id }, data: { nfeProximoNumero: numeroSeq + 1 } });
      // Financeiro: lança a conta a receber da venda (saída).
      await tx.contaReceber.create({
        data: { empresaId, clienteId: dto.clienteId, pedidoId: pedidoVinc?.id, valor, vencimento: vencimentoData, status: 'a_vencer' },
      });
      // Setores: se veio de um pedido em orçamento, avança para aprovado (faturado).
      if (pedidoVinc && pedidoVinc.etapa === 'orcamento') {
        await tx.pedido.update({ where: { id: pedidoVinc.id }, data: { etapa: 'aprovado', status: 'Faturado' } });
      }
      return criada;
    });

    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /**
   * Consulta na Focus o resultado da SEFAZ e ATUALIZA a nota (a emissão é
   * assíncrona: `emitir` devolve "pendente"; a autorização chega depois).
   */
  async consultar(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    if (nota.provedor !== 'focusnfe') {
      return { ...nota, aviso: 'Nota simulada — nada a consultar no provedor.' };
    }
    const filial = nota.filialId
      ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } })
      : null;
    const token = filial?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');

    const ref = this.refDaNota(nota);
    const r = await this.consultarFocus(token, ref);

    const mapa: Record<string, NFeStatus> = {
      autorizado: 'autorizada',
      cancelado: 'cancelada',
      erro_autorizacao: 'rejeitada',
      denegado: 'rejeitada',
      processando_autorizacao: 'pendente',
    };
    const novoStatus = mapa[r.status] ?? nota.status;

    return this.prisma.notaFiscal.update({
      where: { id },
      data: {
        status: novoStatus,
        chave: r.chave ?? nota.chave,
        protocolo: r.protocolo ?? nota.protocolo,
        motivo: r.motivo ?? nota.motivo,
      },
    });
  }

  /** Nota + token do provedor (valida empresa). Uso interno de cancelar/CC-e. */
  private async notaComToken(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
    const token = filial?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    return { nota, token };
  }

  /**
   * CANCELAMENTO na SEFAZ (só notas AUTORIZADAS). Exige justificativa (15+
   * caracteres) e respeita o prazo legal da SEFAZ (24h sem multa em SP).
   */
  async cancelar(id: number, empresaId: number, justificativa: string, usuario: string) {
    const { nota, token } = await this.notaComToken(id, empresaId);
    if (nota.status === 'cancelada') throw new ConflictException('Nota já está cancelada.');
    if (nota.provedor === 'simulado') {
      return this.prisma.notaFiscal.update({ where: { id }, data: { status: 'cancelada', motivo: `Cancelada (simulada) por ${usuario}: ${justificativa}` } });
    }
    if (nota.status !== 'autorizada') {
      throw new ConflictException('Só é possível cancelar na SEFAZ uma nota AUTORIZADA. Para nota rejeitada/pendente, use Excluir.');
    }
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const r = await this.cancelarFocus(token, this.refDaNota(nota), justificativa);
    if (!r.ok) throw new BadRequestException(`Falha ao cancelar na SEFAZ: ${r.motivo}`);
    return this.prisma.notaFiscal.update({
      where: { id },
      data: { status: 'cancelada', motivo: `Cancelada por ${usuario}: ${justificativa}` },
    });
  }

  /**
   * CARTA DE CORREÇÃO (CC-e) — corrige dados que NÃO alteram valores/impostos,
   * destinatário ou datas. Só para notas autorizadas. Justificativa 15+ chars.
   */
  async cartaCorrecao(id: number, empresaId: number, correcao: string, usuario: string) {
    const { nota, token } = await this.notaComToken(id, empresaId);
    if (nota.status !== 'autorizada') throw new ConflictException('A carta de correção só vale para nota AUTORIZADA.');
    if (nota.provedor === 'simulado') {
      return { ok: true, mensagem: 'CC-e registrada (simulada).', correcao };
    }
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const r = await this.cartaCorrecaoFocus(token, this.refDaNota(nota), correcao);
    if (!r.ok) throw new BadRequestException(`Falha na carta de correção: ${r.motivo}`);
    await this.prisma.notaFiscal.update({
      where: { id },
      data: { motivo: `${nota.motivo ?? ''} | CC-e por ${usuario}: ${correcao}`.slice(0, 900) },
    });
    return { ok: true, mensagem: 'Carta de correção enviada à SEFAZ.', correcao };
  }

  /**
   * EXCLUI o registro local de uma nota NÃO autorizada (rejeitada/cancelada/
   * pendente-com-erro/simulada) e, se for o último número emitido, DEVOLVE o
   * sequencial para reutilização. Nota autorizada precisa ser cancelada antes.
   */
  async excluir(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    if (nota.status === 'autorizada') {
      throw new ConflictException('Nota AUTORIZADA não pode ser excluída — cancele na SEFAZ primeiro.');
    }
    const numeroSeq = Number(String(nota.numero).split('/').pop());
    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.notaFiscal.delete({ where: { id } });
      let numeroReutilizado: number | null = null;
      if (nota.filialId) {
        const filial = await tx.filial.findUnique({ where: { id: nota.filialId } });
        // Só devolve o número se ele for o ÚLTIMO consumido (senão abriria buraco).
        if (filial && numeroSeq === filial.nfeProximoNumero - 1) {
          await tx.filial.update({ where: { id: nota.filialId }, data: { nfeProximoNumero: numeroSeq } });
          numeroReutilizado = numeroSeq;
        }
      }
      return { numeroReutilizado };
    });
    return { excluido: true, id, numero: nota.numero, numeroReutilizado: resultado.numeroReutilizado };
  }

  /**
   * Envia a NF (DANFE em PDF + XML) por e-mail ao cliente. Baixa os arquivos
   * na Focus quando a nota está autorizada. Aceita e-mail informado; senão
   * tenta o e-mail do cliente do pedido vinculado.
   */
  async enviarPorEmail(id: number, empresaId: number, emailInformado?: string) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);

    // Destino: e-mail informado ou o do cliente do pedido vinculado.
    let destino = emailInformado?.trim();
    let nomeCliente = '';
    if (nota.pedidoId) {
      const ped = await this.prisma.pedido.findUnique({ where: { id: nota.pedidoId }, include: { cliente: true } });
      nomeCliente = ped?.cliente?.nome ?? '';
      if (!destino) destino = ped?.cliente?.email ?? undefined;
    }
    if (!destino) throw new BadRequestException('Informe o e-mail de destino (a nota não tem cliente vinculado com e-mail).');

    const anexos: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    if (nota.provedor === 'focusnfe' && nota.status === 'autorizada') {
      const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
      const token = filial?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
      if (token) {
        const arq = await this.baixarArquivosFocus(token, this.refDaNota(nota));
        const nome = String(nota.numero).replace('/', '-');
        if (arq.pdf) anexos.push({ filename: `NFe-${nome}.pdf`, content: arq.pdf, contentType: 'application/pdf' });
        if (arq.xml) anexos.push({ filename: `NFe-${nome}.xml`, content: arq.xml, contentType: 'application/xml' });
      }
    }

    const r = await this.email.enviar({
      para: destino,
      assunto: `NF-e ${nota.numero} — GRUPO CHERKESIAN`,
      texto: `Olá${nomeCliente ? ' ' + nomeCliente : ''},\n\nSegue em anexo a nota fiscal eletrônica nº ${nota.numero}` +
        (nota.chave ? ` (chave ${nota.chave})` : '') + `.\n\nAtenciosamente,\nGRUPO CHERKESIAN`,
      anexos: anexos.length ? anexos : undefined,
    });
    return { enviado: r.enviado, simulado: r.simulado, para: destino, anexos: anexos.length, detalhe: r.detalhe };
  }

  /**
   * Baixa um arquivo da nota (DANFE em PDF ou XML) para download/impressão.
   * Retorna o conteúdo + nome + content-type; erro claro se não disponível.
   */
  async baixarArquivo(id: number, empresaId: number, tipo: 'danfe' | 'xml') {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    if (nota.provedor !== 'focusnfe') throw new BadRequestException('Nota simulada não possui DANFE/XML oficial.');
    if (!['autorizada', 'cancelada'].includes(nota.status)) {
      throw new BadRequestException('DANFE/XML só ficam disponíveis após a autorização da SEFAZ.');
    }
    const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
    const token = filial?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const arq = await this.baixarArquivosFocus(token, this.refDaNota(nota));
    const nome = String(nota.numero).replace('/', '-');
    if (tipo === 'danfe') {
      if (!arq.pdf) throw new BadRequestException('DANFE ainda não disponível na Focus. Tente novamente em instantes.');
      return { content: arq.pdf, filename: `DANFE-${nome}.pdf`, contentType: 'application/pdf' };
    }
    if (!arq.xml) throw new BadRequestException('XML ainda não disponível na Focus. Tente novamente em instantes.');
    return { content: arq.xml, filename: `NFe-${nome}.xml`, contentType: 'application/xml' };
  }

  /** Baixa DANFE (PDF) e XML da nota na Focus. */
  private async baixarArquivosFocus(token: string, ref: string) {
    const auth = 'Basic ' + Buffer.from(token + ':').toString('base64');
    const host = this.focusHost();
    const det = (await (await fetch(`https://${host}/v2/nfe/${encodeURIComponent(ref)}`, { headers: { Authorization: auth } }).catch(() => null))?.json().catch(() => ({}))) as Record<string, unknown> | undefined;
    const baixar = async (caminho?: unknown): Promise<Buffer | null> => {
      if (!caminho || typeof caminho !== 'string') return null;
      try {
        const res = await fetch(`https://${host}${caminho}`, { headers: { Authorization: auth } });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    return {
      pdf: await baixar(det?.['caminho_danfe']),
      xml: await baixar(det?.['caminho_xml_nota_fiscal']),
    };
  }

  private async cancelarFocus(token: string, ref: string, justificativa: string) {
    const url = `https://${this.focusHost()}/v2/nfe/${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const status = String(body['status'] ?? '');
      if (res.ok || status === 'cancelado') return { ok: true as const, motivo: 'Cancelada.' };
      return { ok: false as const, motivo: (body['mensagem_sefaz'] as string) || JSON.stringify(body).slice(0, 300) };
    } catch (err) {
      return { ok: false as const, motivo: String(err) };
    }
  }

  private async cartaCorrecaoFocus(token: string, ref: string, correcao: string) {
    const url = `https://${this.focusHost()}/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ correcao }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok || res.status === 202) return { ok: true as const, motivo: 'Enviada.' };
      return { ok: false as const, motivo: (body['mensagem_sefaz'] as string) || JSON.stringify(body).slice(0, 300) };
    } catch (err) {
      return { ok: false as const, motivo: String(err) };
    }
  }

  private async consultarFocus(token: string, ref: string) {
    const url = `https://${this.focusHost()}/v2/nfe/${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64') },
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const status = String(body['status'] ?? '');
      const erros = Array.isArray(body['erros'])
        ? (body['erros'] as Array<{ mensagem?: string }>).map((e) => e.mensagem).filter(Boolean).join('; ')
        : undefined;
      return {
        status,
        chave: (body['chave_nfe'] as string) ?? null,
        protocolo: (body['protocolo'] as string) ?? null,
        motivo:
          (body['mensagem_sefaz'] as string) ||
          erros ||
          `Consulta ao provedor: ${status || 'sem status'}.`,
      };
    } catch (err) {
      this.logger.error(`Falha ao consultar Focus: ${String(err)}`);
      return { status: '', chave: null, protocolo: null, motivo: `Erro ao consultar: ${String(err)}` };
    }
  }

  // ===== Validação =====
  private validarFiscal(emitente: Filial, cliente: Cliente, qtdItens: number): string[] {
    const f: string[] = [];
    if (!emitente.cnpj) f.push('CNPJ da filial emissora');
    if (!emitente.inscricaoEstadual) f.push('Inscrição Estadual da filial');
    if (!emitente.municipio || !emitente.uf || !emitente.cep) f.push('Endereço fiscal da filial');
    if (!cliente.cnpjCpf) f.push('CNPJ/CPF do cliente');
    if (!cliente.municipio || !cliente.uf || !cliente.cep) f.push('Endereço fiscal do cliente');
    if (qtdItens === 0) f.push('itens no pedido');
    return f;
  }

  // ===== Montagem do payload (formato Focus NFe) =====
  /** CFOP conforme a operação: 5xxx dentro do estado, 6xxx interestadual. */
  private ajustarCfop(cfop: string, mesmaUf: boolean): string {
    const c = (cfop || '5101').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
    const alvo = (mesmaUf ? '5' : '6') + c.slice(1);
    // Os CFOPs de "não contribuinte" (x107/x108) SÓ existem na versão
    // interestadual (6107/6108). No mercado interno usa-se 5101/5102.
    if (mesmaUf && alvo === '5107') return '5101';
    if (mesmaUf && alvo === '5108') return '5102';
    return alvo;
  }

  /** Referência da nota na Focus (avulsa usa prefixo NFEAV-, normal usa NFE-). */
  private refDaNota(nota: NotaFiscal): string {
    const numeroSeq = Number(String(nota.numero).split('/').pop());
    const prefixo = nota.expedicaoId ? 'NFE' : 'NFEAV';
    return `${prefixo}-${nota.filialId ?? 0}-${nota.serie}-${numeroSeq}`;
  }

  private async montarPayload(
    emitente: Filial,
    cliente: Cliente,
    exp: { pecas: number },
    itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }>,
    serie: string,
    numero: number,
    valorTotal: Prisma.Decimal,
    infoAdicional?: string,
    extra?: { volumes?: number; duplicatas?: Array<{ numero: string; data_vencimento: string; valor: number }> },
  ) {
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: itens.map((i) => i.produtoId).filter((x): x is number => !!x) } },
    });
    const mapa = new Map(produtos.map((p) => [p.id, p]));
    const docDest = digitos(cliente.cnpjCpf);
    const mesmaUf = (emitente.uf ?? '').toUpperCase() === (cliente.uf ?? '').toUpperCase();

    const regimeNormal = emitente.crt === 3;
    const items = itens.map((it, idx) => {
      const p = it.produtoId ? mapa.get(it.produtoId) : undefined;
      const bruto = it.valorUnit.mul(it.quantidade);
      const unidade = p?.unidadeComercial ?? 'UN';
      const valorUnit = Number(it.valorUnit.toFixed(2));
      const item: Record<string, unknown> = {
        numero_item: idx + 1,
        codigo_produto: p?.codigo ?? String(it.produtoId ?? idx + 1),
        descricao: it.descricao,
        cfop: this.ajustarCfop(p?.cfop ?? '5101', mesmaUf),
        // NCM: a Focus/SEFAZ espera o campo "codigo_ncm" (8 dígitos).
        codigo_ncm: (p?.ncm ?? '').replace(/\D/g, '') || '00000000',
        // Unidade comercial e tributável (SEFAZ exige as duas).
        unidade_comercial: unidade,
        quantidade_comercial: it.quantidade,
        valor_unitario_comercial: valorUnit,
        unidade_tributavel: unidade,
        quantidade_tributavel: it.quantidade,
        valor_unitario_tributavel: valorUnit,
        valor_bruto: Number(bruto.toFixed(2)),
        icms_origem: p?.origem ?? 0,
        icms_situacao_tributaria: p?.icmsCst ?? (regimeNormal ? '00' : '102'),
        pis_situacao_tributaria: p?.pisCst ?? '01',
        cofins_situacao_tributaria: p?.cofinsCst ?? '01',
        // ⚠️ Alíquotas PIS/COFINS — padrão Lucro Presumido (cumulativo).
        // CONFIRME COM A CONTABILIDADE e ajuste por produto quando necessário.
        pis_aliquota_porcentual: 0.65,
        cofins_aliquota_porcentual: 3,
      };
      const baseItem = Number(bruto.toFixed(2));
      if (regimeNormal) {
        // Grupo ICMS (Regime Normal). CSTs tributados (00,10,20,70,90) têm base
        // e valor; isento/não tributado/ST (40,41,50,60) ficam zerados.
        const cstIcms = (p?.icmsCst ?? '00');
        const aliqIcms = p?.icmsAliquota ? Number(p.icmsAliquota) : 18; // % — CONFIRME COM A CONTABILIDADE
        const tributado = ['00', '10', '20', '70', '90'].includes(cstIcms);
        item.icms_modalidade_base_calculo = 3; // 3 = valor da operação
        item.icms_aliquota = aliqIcms;
        item.icms_base_calculo = tributado ? baseItem : 0;
        item.icms_valor = tributado ? Number((baseItem * aliqIcms / 100).toFixed(2)) : 0;
      }
      // PIS/COFINS: base + valor quando tributável (CST 01/02).
      const pisTrib = ['01', '02'].includes((p?.pisCst ?? '01'));
      const cofinsTrib = ['01', '02'].includes((p?.cofinsCst ?? '01'));
      if (pisTrib) {
        item.pis_base_calculo = baseItem;
        item.pis_valor = Number((baseItem * 0.65 / 100).toFixed(2));
      }
      if (cofinsTrib) {
        item.cofins_base_calculo = baseItem;
        item.cofins_valor = Number((baseItem * 3 / 100).toFixed(2));
      }
      return item;
    });

    return {
      natureza_operacao: 'Venda de mercadoria',
      data_emissao: new Date().toISOString(),
      tipo_documento: 1, // 1 = saída
      finalidade_emissao: 1, // 1 = normal
      presenca_comprador: 9,
      modalidade_frete: 9, // 9 = sem ocorrência de transporte (SEFAZ exige o campo)
      serie,
      numero,
      // Emitente (dados também configurados no painel do provedor)
      cnpj_emitente: digitos(emitente.cnpj),
      // Destinatário
      nome_destinatario: cliente.nome,
      [docDest.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: docDest,
      inscricao_estadual_destinatario: cliente.inscricaoEstadual || null,
      indicador_inscricao_estadual_destinatario: cliente.indicadorIE ?? 9,
      logradouro_destinatario: cliente.logradouro,
      numero_destinatario: cliente.numeroEndereco,
      bairro_destinatario: cliente.bairro,
      municipio_destinatario: cliente.municipio,
      uf_destinatario: cliente.uf,
      cep_destinatario: digitos(cliente.cep),
      valor_total: Number(valorTotal.toFixed(2)),
      volumes_quantidade: extra?.volumes ?? exp.pecas,
      ...(extra?.duplicatas && extra.duplicatas.length
        ? {
            // Grupo de cobrança (fatura + duplicatas) — leva o vencimento p/ o cliente.
            fatura_numero: String(numero),
            fatura_valor_original: Number(valorTotal.toFixed(2)),
            fatura_valor_liquido: Number(valorTotal.toFixed(2)),
            duplicatas: extra.duplicatas,
          }
        : {}),
      ...(infoAdicional ? { informacoes_adicionais_contribuinte: infoAdicional.slice(0, 5000) } : {}),
      items,
    };
  }

  /** Host da API Focus por ambiente (produção usa api.; homologação usa homologacao.). */
  private focusHost(): string {
    return this.config.get<string>('NFE_AMBIENTE') === 'producao'
      ? 'api.focusnfe.com.br'
      : 'homologacao.focusnfe.com.br';
  }

  // ===== Provedores =====
  private async emitirFocusNfe(token: string, ref: string, payload: unknown) {
    const url = `https://${this.focusHost()}/v2/nfe?ref=${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 202 || res.ok) {
        return {
          chave: (body['chave_nfe'] as string) ?? null,
          status: 'pendente' as const,
          protocolo: (body['protocolo'] as string) ?? null,
          motivo: 'Enviada ao provedor; aguardando autorização da SEFAZ.',
          provedor: 'focusnfe',
        };
      }
      return {
        chave: null,
        status: 'rejeitada' as const,
        protocolo: null,
        motivo: `Focus NFe HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`,
        provedor: 'focusnfe',
      };
    } catch (err) {
      this.logger.error(`Falha na Focus NFe: ${String(err)}`);
      return {
        chave: null,
        status: 'rejeitada' as const,
        protocolo: null,
        motivo: `Erro de comunicação com o provedor: ${String(err)}`,
        provedor: 'focusnfe',
      };
    }
  }

  private emitirSimulada() {
    return {
      chave: this.gerarChaveSimulada(),
      status: 'simulada' as const,
      protocolo: `SIM${Date.now()}`,
      motivo: 'NF-e SIMULADA (sem valor fiscal). Configure FOCUS_NFE_TOKEN + certificado A1 para emitir de verdade.',
      provedor: 'simulado',
    };
  }

  private gerarChaveSimulada(): string {
    const agora = new Date();
    const aamm = String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0');
    let chave = '35' + aamm + '00000000000000' + '55' + '001';
    while (chave.length < 44) chave += String(Math.floor(Math.random() * 10));
    return chave.slice(0, 44);
  }
}
