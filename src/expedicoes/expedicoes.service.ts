import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Expedicao, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpedicaoDto } from './dto/create-expedicao.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

// bwip-js gera QR Code e código de barras (Code128) como PNG.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js') as { toBuffer: (opts: Record<string, unknown>) => Promise<Buffer> };

@Injectable()
export class ExpedicoesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados da etiqueta de expedição (preenchida do pedido) + QR e código de barras. */
  async etiqueta(id: number, empresaId: number) {
    const exp = await this.prisma.expedicao.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    // Venda de mercadoria: a etiqueta de expedição só é liberada com a NF-e emitida (autorizada).
    const nfEmitida = await this.prisma.notaFiscal.findFirst({
      where: { expedicaoId: id, status: { in: ['autorizada', 'simulada'] } },
      orderBy: { id: 'desc' },
      select: { numero: true, status: true },
    });
    if (!nfEmitida) {
      const pend = await this.prisma.notaFiscal.findFirst({ where: { expedicaoId: id }, orderBy: { id: 'desc' }, select: { status: true } });
      const motivo = pend?.status === 'pendente'
        ? 'a NF-e ainda está pendente de autorização na SEFAZ. Aguarde/consulte a autorização.'
        : pend?.status === 'rejeitada' ? 'a NF-e foi rejeitada — corrija e reemita.'
        : pend?.status === 'cancelada' ? 'a NF-e desta expedição foi cancelada.'
        : 'nenhuma NF-e de venda foi emitida para esta expedição.';
      throw new BadRequestException(`Etiqueta bloqueada: ${motivo} Emita a NF-e de venda antes de gerar a etiqueta de expedição.`);
    }
    const pedido = exp.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true, filial: true } })
      : null;
    // Expedição parcial: usa o snapshot (exp.itens); senão, os itens do pedido.
    const snap = exp.itens as Array<{ produtoId: number | null; descricao: string; quantidade: number; grade?: Record<string, number> | null }> | null;
    const baseItens: Array<{ produtoId: number | null; descricao: string; quantidade: number; grade: unknown }> =
      (snap && snap.length) ? snap.map((s) => ({ produtoId: s.produtoId ?? null, descricao: s.descricao, quantidade: s.quantidade, grade: s.grade ?? null }))
        : (pedido?.itens ?? []).map((i) => ({ produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, grade: i.grade }));
    const prodIds = baseItens.map((i) => i.produtoId).filter((x): x is number => !!x);
    const produtos = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true } }) : [];
    const codMap = new Map(produtos.map((p) => [p.id, p.codigo]));
    const itens = baseItens.map((i) => {
      const g = i.grade as Record<string, number> | null;
      const grade = g && Object.keys(g).length ? Object.entries(g).map(([t, q]) => `${t}: ${q}`).join('   ') : '—';
      return { codigo: i.produtoId ? codMap.get(i.produtoId) ?? '—' : '—', descricao: i.descricao, grade, quantidade: i.quantidade };
    });
    const totalPecas = itens.reduce((s, i) => s + i.quantidade, 0) || exp.pecas;
    const codBip = String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const emp = pedido?.filial;
    const [qr, barcode] = await Promise.all([
      bwipjs.toBuffer({ bcid: 'qrcode', text: codBip, scale: 4, padding: 0 }),
      bwipjs.toBuffer({ bcid: 'code128', text: codBip, scale: 2, height: 14, includetext: false, padding: 0 }),
    ]);
    return {
      empresa: emp ? { nome: emp.nome, cnpj: emp.cnpj } : { nome: 'GRUPO CHERKESIAN', cnpj: null },
      numero: exp.numero,
      nf: exp.nf ?? null,
      pedido: pedido?.numero ?? '—',
      data: new Date().toISOString(),
      codBip,
      destino: {
        nome: cliente.nome,
        endereco: cliente.logradouro ?? '—',
        cidadeUf: cliente.cidadeUf ?? (cliente.municipio && cliente.uf ? `${cliente.municipio}/${cliente.uf}` : '—'),
        cep: cliente.cep ?? '—',
        cnpj: cliente.cnpjCpf ?? '—',
      },
      lote: exp.loteId ? String(exp.loteId) : null,
      volumes: exp.volumes,
      itens,
      totalPecas,
      qr: 'data:image/png;base64,' + qr.toString('base64'),
      barcode: 'data:image/png;base64,' + barcode.toString('base64'),
    };
  }

  async findAll(empresaId: number): Promise<Expedicao[]> {
    const clienteIds = await this.clienteIdsDaEmpresa(empresaId);
    return this.prisma.expedicao.findMany({
      where: { clienteId: { in: clienteIds } },
      orderBy: { id: 'desc' },
    });
  }

  async create(dto: CreateExpedicaoDto, empresaId: number): Promise<Expedicao> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }
    if (dto.pedidoId) {
      const pedido = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId } });
      if (!pedido || pedido.empresaId !== empresaId) {
        throw new NotFoundException(`Pedido ${dto.pedidoId} não encontrado.`);
      }
    }

    // Se houver lote, consome (baixa lote + estoque) atomicamente com a expedição.
    if (dto.loteId) {
      const lote = await this.prisma.lote.findUnique({
        where: { id: dto.loteId },
        include: { estoque: { include: { produto: { select: { empresaId: true } } } } },
      });
      if (!lote || lote.estoque.produto.empresaId !== empresaId) {
        throw new NotFoundException(`Lote ${dto.loteId} não encontrado.`);
      }
      if (lote.quantidade < dto.pecas) {
        throw new BadRequestException(
          `Lote ${lote.codigoLote} tem apenas ${lote.quantidade} peças (pedido: ${dto.pecas}).`,
        );
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.lote.update({
          where: { id: lote.id },
          data: { quantidade: { decrement: dto.pecas } },
        });
        await tx.estoque.update({
          where: { id: lote.estoqueId },
          data: { saidas: { increment: dto.pecas } },
        });
        return tx.expedicao.create({ data: await this.montarDados(dto, tx) });
      });
    }

    return this.prisma.expedicao.create({ data: await this.montarDados(dto, this.prisma) });
  }

  /**
   * Gera a expedição DIRETO do pedido (revenda/faturamento sem produção): pula
   * a OP, cria a expedição com as peças do pedido e avança a etapa p/ expedição.
   * Depois é só emitir a NF a partir dessa expedição.
   */
  private async pedidoParaExpedir(pedidoId: number, empresaId: number) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, include: { itens: true, cliente: true } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    if (pedido.etapa === 'orcamento') throw new BadRequestException('Aprove o pedido antes de gerar a expedição.');
    return pedido;
  }

  /** Expedição TOTAL (do restante que ainda falta expedir). */
  async criarDoPedido(pedidoId: number, empresaId: number): Promise<Expedicao> {
    const pedido = await this.pedidoParaExpedir(pedidoId, empresaId);
    const sel = pedido.itens
      .map((it) => ({ item: it, qtd: it.quantidade - (it.quantidadeExpedida ?? 0) }))
      .filter((x) => x.qtd > 0);
    if (!sel.length) throw new ConflictException('Pedido já foi totalmente expedido.');
    return this.criarExpedicao(pedido, sel, false);
  }

  /** Expedição PARCIAL: expede só as quantidades escolhidas; o residual fica em aberto. */
  async criarParcial(pedidoId: number, dto: { itens: Array<{ pedidoItemId: number; quantidade: number }> }, empresaId: number): Promise<Expedicao> {
    const pedido = await this.pedidoParaExpedir(pedidoId, empresaId);
    const mapItem = new Map(pedido.itens.map((i) => [i.id, i]));
    const sel: Array<{ item: (typeof pedido.itens)[number]; qtd: number }> = [];
    for (const s of dto.itens ?? []) {
      const it = mapItem.get(s.pedidoItemId);
      if (!it) throw new BadRequestException(`Item ${s.pedidoItemId} não pertence ao pedido ${pedido.numero}.`);
      const residual = it.quantidade - (it.quantidadeExpedida ?? 0);
      const q = Math.floor(Number(s.quantidade) || 0);
      if (q < 0 || q > residual) throw new BadRequestException(`Quantidade inválida para "${it.descricao}" (residual disponível: ${residual}).`);
      if (q > 0) sel.push({ item: it, qtd: q });
    }
    if (!sel.length) throw new BadRequestException('Informe ao menos uma quantidade para expedir.');
    return this.criarExpedicao(pedido, sel, true);
  }

  private async criarExpedicao(
    pedido: { id: number; numero: string; clienteId: number; cliente: { logradouro: string | null; cidadeUf: string | null; municipio: string | null; uf: string | null; cep: string | null } },
    sel: Array<{ item: { id: number; produtoId: number | null; descricao: string; quantidade: number; quantidadeExpedida: number; valorUnit: unknown; grade: unknown }; qtd: number }>,
    parcial: boolean,
  ): Promise<Expedicao> {
    const itensSnap = sel.map(({ item, qtd }) => ({
      pedidoItemId: item.id,
      produtoId: item.produtoId,
      descricao: item.descricao,
      quantidade: qtd,
      valorUnit: Number(item.valorUnit),
      // grade só quando expede o item inteiro de uma vez (senão o tamanho fica indefinido)
      grade: qtd === item.quantidade && (item.quantidadeExpedida ?? 0) === 0 ? (item.grade ?? null) : null,
    }));
    const pecas = sel.reduce((s, x) => s + x.qtd, 0) || 1;
    const c = pedido.cliente;
    const cidadeUf = c.cidadeUf ?? (c.municipio && c.uf ? `${c.municipio}/${c.uf}` : undefined);
    return this.prisma.$transaction(async (tx) => {
      const numero = await this.gerarNumero(tx);
      const exp = await tx.expedicao.create({
        data: {
          numero, pedidoId: pedido.id, clienteId: pedido.clienteId, pecas,
          endereco: c.logradouro ?? undefined, cidadeUf, cep: c.cep ?? undefined,
          volumes: 1, rastreio: this.gerarRastreio(), status: 'Separado',
          parcial, itens: itensSnap as unknown as Prisma.InputJsonValue,
        },
      });
      for (const { item, qtd } of sel) {
        await tx.pedidoItem.update({ where: { id: item.id }, data: { quantidadeExpedida: { increment: qtd } } });
      }
      const atual = await tx.pedidoItem.findMany({ where: { pedidoId: pedido.id }, select: { quantidade: true, quantidadeExpedida: true } });
      const totalmente = atual.every((i) => (i.quantidadeExpedida ?? 0) >= i.quantidade);
      await tx.pedido.update({
        where: { id: pedido.id },
        data: totalmente ? { etapa: 'expedicao', status: 'Expedição' } : { status: 'Expedição parcial' },
      });
      return exp;
    });
  }

  // ===================== DUPLA CONFERÊNCIA + DESPACHO =====================
  private async getExp(id: number, empresaId: number) {
    const exp = await this.prisma.expedicao.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    return exp;
  }

  private extrairCodigo(input: string): string {
    const t = (input ?? '').trim();
    if (t.startsWith('{')) { try { return String(JSON.parse(t).kit ?? '').trim() || t; } catch { return t; } }
    return t;
  }

  async conferencia(id: number, empresaId: number) {
    const exp = await this.getExp(id, empresaId);
    return {
      numero: exp.numero,
      codBip: String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase(), // código da etiqueta MASTER
      esperadas: exp.pecas, conferidas: exp.pecasConferidas,
      status: exp.conferenciaStatus, nf: exp.nf, dataSaida: exp.dataSaida,
    };
  }

  /** Bipa uma peça unitária (ou um kit) na conferência de expedição. Idempotente para kits. */
  async conferir(id: number, empresaId: number, codigoRaw: string, usuario: string) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') throw new ConflictException('Expedição já despachada — não é possível conferir.');
    const codigo = this.extrairCodigo(codigoRaw);
    if (!codigo) throw new BadRequestException('Bipe um código válido.');
    const esperadas = exp.pecas;
    const conferidos = ((exp.conferidos as string[] | null) ?? []).slice();
    // Idempotência: cada código único (etiqueta unitária ou kit) conta uma vez.
    if (conferidos.includes(codigo)) {
      return { ja: true, mensagem: `${codigo} já foi conferido.`, conferidas: exp.pecasConferidas, esperadas, status: exp.conferenciaStatus };
    }
    let add = 1;
    let detalhe = codigo;
    if (/^KIT-/i.test(codigo)) {
      const kit = await this.prisma.kit.findUnique({ where: { codigo } });
      if (!kit || kit.empresaId !== empresaId) throw new NotFoundException(`Kit ${codigo} não encontrado.`);
      add = kit.jogos || 1; detalhe = `${codigo} (${add} pç)`;
    } else {
      // Baixa automática: se o código for uma unidade de estoque, marca como despachada.
      const un = await this.prisma.unidadeEstoque.findFirst({ where: { codigo, empresaId } });
      if (un && un.status !== 'despachado') {
        await this.prisma.unidadeEstoque.update({ where: { id: un.id }, data: { status: 'despachado', expedicaoId: id, saidaEm: new Date() } });
        detalhe = `${codigo} (baixa estoque)`;
      }
    }
    conferidos.push(codigo);
    const novas = Math.min(esperadas, exp.pecasConferidas + add);
    const completou = novas >= esperadas;
    await this.prisma.expedicao.update({
      where: { id },
      data: { pecasConferidas: novas, conferidos, conferenciaStatus: completou ? 'conferida' : 'conferindo', conferidoPor: usuario, ...(completou ? { conferidoEm: new Date() } : {}) },
    });
    return {
      ja: false,
      mensagem: completou ? `Conferência concluída! ${novas}/${esperadas}. Libere a etiqueta master e despache.` : `Conferido: ${detalhe}. ${novas}/${esperadas}.`,
      conferidas: novas, esperadas, status: completou ? 'conferida' : 'conferindo', completou,
    };
  }

  /** Despacha a mercadoria (só após a conferência): registra a data de saída ao cliente.
   *  A saída é liberada bipando a ETIQUETA MASTER da caixa (codigoMaster) — 2ª leitura da dupla conferência. */
  async despachar(id: number, empresaId: number, usuario: string, codigoMaster?: string) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') return { ja: true, mensagem: 'Expedição já despachada.', dataSaida: exp.dataSaida };
    if (exp.conferenciaStatus !== 'conferida') throw new ConflictException(`Conclua a conferência (${exp.pecasConferidas}/${exp.pecas}) antes de despachar.`);
    // 2ª leitura: exige a etiqueta MASTER correta desta expedição.
    if (codigoMaster != null) {
      const master = String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const bip = this.extrairCodigo(codigoMaster).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (!bip) throw new BadRequestException('Bipe a etiqueta MASTER da caixa para despachar.');
      if (bip !== master) throw new BadRequestException(`Etiqueta master incorreta (${bip}). Bipe a etiqueta master desta expedição (${exp.numero}).`);
    }
    const now = new Date();
    await this.prisma.expedicao.update({ where: { id }, data: { conferenciaStatus: 'despachado', status: 'Despachado', dataSaida: now, despachadoPor: usuario } });
    return { ja: false, mensagem: 'Mercadoria DESPACHADA. Data de saída registrada.', dataSaida: now };
  }

  /** Gera uma etiqueta UNITÁRIA por peça (código único + código de barras) p/ bipagem 1-a-1. */
  async etiquetasUnitarias(id: number, empresaId: number) {
    const exp = await this.getExp(id, empresaId);
    const pedido = exp.pedidoId ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true, filial: true } }) : null;
    const prodIds = (pedido?.itens ?? []).map((i) => i.produtoId).filter((x): x is number => !!x);
    const produtos = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true } }) : [];
    const codMap = new Map(produtos.map((p) => [p.id, p.codigo]));
    const codBip = String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    const pecas: Array<{ produto: string; descricao: string; tamanho: string }> = [];
    for (const it of pedido?.itens ?? []) {
      const g = it.grade as Record<string, number> | null;
      const prod = it.produtoId ? codMap.get(it.produtoId) ?? '—' : '—';
      if (g && Object.keys(g).length) {
        for (const [tam, q] of Object.entries(g)) for (let k = 0; k < Number(q); k++) pecas.push({ produto: prod, descricao: it.descricao, tamanho: tam.toUpperCase() });
      } else {
        for (let k = 0; k < it.quantidade; k++) pecas.push({ produto: prod, descricao: it.descricao, tamanho: '—' });
      }
    }
    if (!pecas.length) throw new BadRequestException('Sem itens no pedido para gerar etiquetas unitárias.');
    if (pecas.length > 500) throw new BadRequestException(`${pecas.length} peças — muitas etiquetas unitárias (máx. 500). Use a conferência por kit.`);

    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    const out: Array<{ produto: string; descricao: string; tamanho: string; codigo: string; barcode: string }> = [];
    let seq = 0;
    for (const p of pecas) {
      seq++;
      const codigo = `${codBip}-${String(seq).padStart(3, '0')}`;
      const bc = await bwipjs.toBuffer({ bcid: 'code128', text: codigo, scale: 2, height: 12, includetext: false, padding: 0 });
      out.push({ ...p, codigo, barcode: 'data:image/png;base64,' + bc.toString('base64') });
    }
    const emp = pedido?.filial;
    return {
      empresa: emp ? { nome: emp.nome } : { nome: 'GRUPO CHERKESIAN' },
      numero: exp.numero, nf: exp.nf, pedido: pedido?.numero ?? '—',
      destino: cliente?.nome ?? '—', total: out.length, pecas: out,
    };
  }

  private async montarDados(
    dto: CreateExpedicaoDto,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<Prisma.ExpedicaoCreateInput> {
    const numero = await this.gerarNumero(client);
    return {
      numero,
      pedidoId: dto.pedidoId,
      clienteId: dto.clienteId,
      loteId: dto.loteId,
      pecas: dto.pecas,
      endereco: dto.endereco,
      cidadeUf: dto.cidadeUf,
      cep: dto.cep,
      nf: dto.nf,
      transportadora: dto.transportadora,
      volumes: dto.volumes ?? 1,
      rastreio: this.gerarRastreio(),
      status: 'Separado',
    };
  }

  private async clienteIdsDaEmpresa(empresaId: number): Promise<number[]> {
    const clientes = await this.prisma.cliente.findMany({
      where: { empresaId },
      select: { id: true },
    });
    return clientes.map((c) => c.id);
  }

  private async gerarNumero(client: Prisma.TransactionClient | PrismaService): Promise<string> {
    const existentes = await client.expedicao.findMany({ select: { numero: true } });
    return proximoSequencial('EXP', existentes.map((e) => e.numero), { pad: 4, separador: '-' });
  }

  /** Rastreio simples baseado no tempo (placeholder até integração com transportadora). */
  private gerarRastreio(): string {
    return `BR${Date.now().toString(36).toUpperCase()}CK`;
  }
}
