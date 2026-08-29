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

type CaixaLinha = { descricao: string; cor?: string | null; tamanho?: string | null; qtd: number };

/** Item selecionado para uma expedição (parcial ou total), com grade opcional por tamanho. */
type SelExped = {
  item: { id: number; produtoId: number | null; descricao: string; cor?: string | null; quantidade: number; quantidadeExpedida: number; valorUnit: unknown; grade: unknown; gradeExpedida: unknown };
  qtd: number;
  gradeShip?: Record<string, number>;
};

@Injectable()
export class ExpedicoesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados da etiqueta de expedição (preenchida do pedido) + QR e código de barras. */
  // ===== Plano de embalagem por caixa (packing list + etiqueta de conteúdo) =====
  private async expDaEmpresa(id: number, empresaId: number) {
    const exp = await this.prisma.expedicao.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    return { exp, cliente };
  }

  /** Salva o plano de caixas da expedição (substitui integralmente). */
  async salvarCaixas(id: number, empresaId: number, caixas: Array<{ conteudo?: Array<{ descricao?: string; cor?: string | null; tamanho?: string | null; qtd?: number }>; peso?: number }>) {
    await this.expDaEmpresa(id, empresaId);
    const limpas = (caixas ?? []).map((c, i) => {
      const conteudo = (c.conteudo ?? [])
        .map((l) => ({ descricao: (l.descricao ?? '').trim(), cor: l.cor?.trim() || null, tamanho: l.tamanho?.trim() || null, qtd: Math.round(Number(l.qtd) || 0) }))
        .filter((l) => l.descricao && l.qtd > 0);
      const pecas = conteudo.reduce((s, l) => s + l.qtd, 0);
      return { numero: i + 1, conteudo, pecas, peso: c.peso != null ? Number(c.peso) : null };
    }).filter((c) => c.conteudo.length);
    await this.prisma.expedicao.update({ where: { id }, data: { caixas: limpas as unknown as Prisma.InputJsonValue } });
    const totalPecas = limpas.reduce((s, c) => s + c.pecas, 0);
    return { caixas: limpas, totalCaixas: limpas.length, totalPecas };
  }

  /** Dados das etiquetas de conteúdo (uma por caixa) para impressão. */
  async etiquetasCaixas(id: number, empresaId: number) {
    const { exp, cliente } = await this.expDaEmpresa(id, empresaId);
    const caixas = (exp.caixas as Array<{ numero: number; conteudo: CaixaLinha[]; pecas: number; peso?: number | null }> | null) ?? [];
    if (!caixas.length) throw new BadRequestException('Nenhuma caixa montada nesta expedição. Use "Montar caixas" primeiro.');
    const pedido = exp.pedidoId ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, select: { numero: true } }) : null;
    const total = caixas.length;
    const etiquetas = [];
    for (const c of caixas) {
      const codigo = `${String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase()}-CX${c.numero}`;
      const [qr, barcode] = await Promise.all([
        bwipjs.toBuffer({ bcid: 'qrcode', text: codigo, scale: 4, padding: 0 }),
        bwipjs.toBuffer({ bcid: 'code128', text: codigo, scale: 2, height: 12, includetext: false, padding: 0 }),
      ]);
      etiquetas.push({
        codigo, caixaNum: c.numero, totalCaixas: total,
        expedicao: exp.numero, pedido: pedido?.numero ?? null, nf: exp.nf ?? null,
        cliente: cliente.nome, cidadeUf: cliente.cidadeUf ?? (cliente.municipio && cliente.uf ? `${cliente.municipio}/${cliente.uf}` : '—'),
        conteudo: c.conteudo, pecas: c.pecas, peso: c.peso ?? null,
        qr: 'data:image/png;base64,' + qr.toString('base64'),
        barcode: 'data:image/png;base64,' + barcode.toString('base64'),
      });
    }
    return { total, etiquetas };
  }

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

  async findAll(empresaId: number) {
    const clienteIds = await this.clienteIdsDaEmpresa(empresaId);
    // Omite a imagem do canhoto na listagem (pesada); canhotoEm indica que há canhoto.
    const rows = await this.prisma.expedicao.findMany({
      where: { clienteId: { in: clienteIds } },
      orderBy: { id: 'desc' },
      omit: { canhotoImg: true },
    });
    // Anexa o nome do cliente e o nº do pedido de origem (identificação rápida na lista/TV).
    const clis = await this.prisma.cliente.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.clienteId))] } }, select: { id: true, nome: true } });
    const nome = new Map(clis.map((c) => [c.id, c.nome]));
    const pedIds = [...new Set(rows.map((r) => r.pedidoId).filter((x): x is number => !!x))];
    const peds = pedIds.length ? await this.prisma.pedido.findMany({ where: { id: { in: pedIds } }, select: { id: true, numero: true } }) : [];
    const pedNum = new Map(peds.map((p) => [p.id, p.numero]));
    return rows.map((r) => ({ ...r, clienteNome: nome.get(r.clienteId) ?? null, pedidoNumero: r.pedidoId ? pedNum.get(r.pedidoId) ?? null : null }));
  }

  private async garantirExp(id: number, empresaId: number): Promise<Expedicao> {
    const exp = await this.prisma.expedicao.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    const cli = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId }, select: { empresaId: true } });
    if (!cli || cli.empresaId !== empresaId) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    return exp;
  }

  /** Arquiva a foto do canhoto assinado da NF (base64). */
  async salvarCanhoto(id: number, empresaId: number, img: string) {
    await this.garantirExp(id, empresaId);
    const s = (img ?? '').trim();
    if (!/^data:image\/[a-zA-Z+]+;base64,/.test(s)) throw new BadRequestException('Envie uma imagem (foto do canhoto).');
    if (s.length > 8_000_000) throw new BadRequestException('Imagem muito grande. Tire a foto com resolução menor (máx ~6 MB).');
    await this.prisma.expedicao.update({ where: { id }, data: { canhotoImg: s, canhotoEm: new Date() } });
    return { ok: true, canhotoEm: new Date() };
  }

  /** Retorna a foto do canhoto arquivado. */
  async getCanhoto(id: number, empresaId: number) {
    const exp = await this.garantirExp(id, empresaId);
    if (!exp.canhotoImg) throw new NotFoundException('Nenhum canhoto arquivado para esta expedição.');
    return { img: exp.canhotoImg, canhotoEm: exp.canhotoEm };
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

  /** Expedição TOTAL (do restante que ainda falta expedir — por tamanho quando há grade). */
  async criarDoPedido(pedidoId: number, empresaId: number): Promise<Expedicao> {
    const pedido = await this.pedidoParaExpedir(pedidoId, empresaId);
    const sel: SelExped[] = [];
    for (const it of pedido.itens) {
      const grade = it.grade as Record<string, number> | null;
      if (grade && Object.keys(grade).length) {
        const jaG = (it.gradeExpedida as Record<string, number> | null) ?? {};
        const resto: Record<string, number> = {};
        for (const [t, q] of Object.entries(grade)) { const r = Number(q) - Number(jaG[t] ?? 0); if (r > 0) resto[t] = r; }
        const qtd = Object.values(resto).reduce((s, q) => s + q, 0);
        if (qtd > 0) sel.push({ item: it, qtd, gradeShip: resto });
      } else {
        const r = it.quantidade - (it.quantidadeExpedida ?? 0);
        if (r > 0) sel.push({ item: it, qtd: r });
      }
    }
    if (!sel.length) throw new ConflictException('Pedido já foi totalmente expedido.');
    return this.criarExpedicao(pedido, sel, false);
  }

  /** Expedição PARCIAL: expede só o escolhido (por tamanho quando há grade); o residual fica em aberto. */
  async criarParcial(pedidoId: number, dto: { itens: Array<{ pedidoItemId: number; quantidade?: number; grade?: Record<string, number> }> }, empresaId: number): Promise<Expedicao> {
    const pedido = await this.pedidoParaExpedir(pedidoId, empresaId);
    const mapItem = new Map(pedido.itens.map((i) => [i.id, i]));
    const sel: SelExped[] = [];
    for (const s of dto.itens ?? []) {
      const it = mapItem.get(s.pedidoItemId);
      if (!it) throw new BadRequestException(`Item ${s.pedidoItemId} não pertence ao pedido ${pedido.numero}.`);
      const grade = it.grade as Record<string, number> | null;
      if (grade && Object.keys(grade).length && s.grade) {
        const jaG = (it.gradeExpedida as Record<string, number> | null) ?? {};
        const gradeShip: Record<string, number> = {};
        for (const [t, qRaw] of Object.entries(s.grade)) {
          const q = Math.floor(Number(qRaw) || 0);
          if (q <= 0) continue;
          const resid = Number(grade[t] ?? 0) - Number(jaG[t] ?? 0);
          if (q > resid) throw new BadRequestException(`"${it.descricao}" TAM ${t}: máximo ${resid} (residual).`);
          gradeShip[t] = q;
        }
        const qtd = Object.values(gradeShip).reduce((a, b) => a + b, 0);
        if (qtd > 0) sel.push({ item: it, qtd, gradeShip });
      } else {
        const residual = it.quantidade - (it.quantidadeExpedida ?? 0);
        const q = Math.floor(Number(s.quantidade) || 0);
        if (q < 0 || q > residual) throw new BadRequestException(`Quantidade inválida para "${it.descricao}" (residual: ${residual}).`);
        if (q > 0) sel.push({ item: it, qtd: q });
      }
    }
    if (!sel.length) throw new BadRequestException('Informe ao menos uma quantidade para expedir.');
    return this.criarExpedicao(pedido, sel, true);
  }

  private async criarExpedicao(
    pedido: { id: number; numero: string; clienteId: number; cliente: { logradouro: string | null; cidadeUf: string | null; municipio: string | null; uf: string | null; cep: string | null } },
    sel: SelExped[],
    parcial: boolean,
  ): Promise<Expedicao> {
    const itensSnap = sel.map(({ item, qtd, gradeShip }) => ({
      pedidoItemId: item.id,
      produtoId: item.produtoId,
      descricao: item.descricao,
      cor: item.cor ?? null, // cor escolhida no pedido (p/ montar caixas por cor)
      quantidade: qtd,
      valorUnit: Number(item.valorUnit),
      grade: gradeShip ?? null, // grade DESTA remessa (por tamanho) → a NF quebra por tamanho
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
      for (const { item, qtd, gradeShip } of sel) {
        let novaGrade: Record<string, number> | undefined;
        if (gradeShip) {
          const jaG = (item.gradeExpedida as Record<string, number> | null) ?? {};
          novaGrade = { ...jaG };
          for (const [t, q] of Object.entries(gradeShip)) novaGrade[t] = Number(novaGrade[t] ?? 0) + Number(q);
        }
        await tx.pedidoItem.update({
          where: { id: item.id },
          data: { quantidadeExpedida: { increment: qtd }, ...(novaGrade ? { gradeExpedida: novaGrade as unknown as Prisma.InputJsonValue } : {}) },
        });
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

  /** Normaliza o tamanho p/ casar grade x etiqueta (ex.: "G1 (FRISO VERMELHO)" -> "G1"). */
  private normTamanho(s?: string | null): string {
    return String(s ?? '').trim().toUpperCase().split(/[\s(]/)[0];
  }

  /** Casa a cor da linha do pedido (ex.: "9158 Cinza Chumbo Mescla") com a cor da
   *  etiqueta (ex.: "9158 CINZA CHUMBO MESCLA LOTE: x" ou só "CINZA"). Código numérico
   *  tem prioridade; sem código, casa pela 1ª palavra de cor. */
  private corCombina(itemCor?: string | null, stockCor?: string | null): boolean {
    if (!itemCor) return true;
    const ic = String(itemCor).toUpperCase().replace(/\s+/g, ' ').trim();
    const sc = String(stockCor ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!sc) return false;
    const itok = (ic.match(/^\d+/) || [])[0];
    const stok = (sc.match(/^\d+/) || [])[0];
    if (stok) return itok ? itok === stok : sc.includes(ic.split(' ')[0]);
    const iw = ic.replace(/^\d+\s*/, '').replace(/\bLOTE.*$/, '').trim().split(' ').filter(Boolean);
    const sw = sc.replace(/^\d+\s*/, '').replace(/\bLOTE.*$/, '').trim().split(' ').filter(Boolean);
    return !!(iw[0] && sw[0] && iw[0] === sw[0]);
  }

  private extrairCodigo(input: string): string {
    let t = (input ?? '').trim();
    if (t.startsWith('{')) { try { t = String(JSON.parse(t).kit ?? '').trim() || t; } catch { /* mantém t */ } }
    // O leitor às vezes GRUDA a mesma etiqueta 2x ("UN-...589UN-...589") ou vem com lixo
    // em volta. Extrai o PRIMEIRO código canônico — assim a leitura dupla normaliza para o
    // mesmo código e a idempotência recusa (não conta em dobro).
    const un = t.match(/UN-\d{8}-\d{6}/i);
    if (un) return un[0].toUpperCase();
    const kit = t.match(/KIT-\d{8}-\d{6}/i);
    if (kit) return kit[0].toUpperCase();
    const cx = t.match(/[A-Za-z0-9]+-CX\d+/i);
    if (cx) return cx[0].toUpperCase();
    return t;
  }

  async conferencia(id: number, empresaId: number) {
    const exp = await this.getExp(id, empresaId);
    const caixas = ((exp.caixas as Array<{ numero: number; pecas: number; conferida?: boolean; viaBip?: boolean; conteudo?: CaixaLinha[] }> | null) ?? [])
      .map((c) => ({ numero: c.numero, pecas: c.pecas, conferida: !!c.conferida, viaBip: !!c.viaBip, conteudo: c.conteudo ?? [] }));

    // Grade da conferência: esperado × conferido × falta, por (descrição · tamanho).
    // Esperado vem do snapshot de itens da expedição (com grade); se não houver,
    // cai nos itens do pedido de origem. Conferido vem do conteúdo das caixas bipadas.
    const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();
    let itens = (exp.itens as Array<{ descricao?: string; cor?: string | null; quantidade?: number; grade?: Record<string, number> | null }> | null) ?? [];
    if (!itens.length && exp.pedidoId) {
      const ped = await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true } });
      itens = (ped?.itens ?? []).map((it) => ({ descricao: it.descricao, cor: it.cor, quantidade: it.quantidade, grade: (it.grade as Record<string, number> | null) }));
    }
    const esp = new Map<string, { descricao: string; cor: string | null; tamanho: string; esperado: number }>();
    for (const it of itens) {
      const desc = it.descricao ?? '';
      const grade = it.grade && typeof it.grade === 'object' ? it.grade : null;
      if (grade && Object.keys(grade).length) {
        for (const [t, q] of Object.entries(grade)) {
          const k = norm(desc) + '|' + norm(t);
          const cur = esp.get(k) ?? { descricao: desc, cor: it.cor ?? null, tamanho: t, esperado: 0 };
          cur.esperado += Number(q) || 0; esp.set(k, cur);
        }
      } else {
        const k = norm(desc) + '|';
        const cur = esp.get(k) ?? { descricao: desc, cor: it.cor ?? null, tamanho: '—', esperado: 0 };
        cur.esperado += Number(it.quantidade) || 0; esp.set(k, cur);
      }
    }
    const conf = new Map<string, number>();
    for (const c of caixas) for (const l of (c.conteudo ?? [])) {
      const k = norm(l.descricao) + '|' + norm(l.tamanho);
      conf.set(k, (conf.get(k) ?? 0) + (Number(l.qtd) || 0));
    }
    const chaves = new Set<string>([...esp.keys(), ...conf.keys()]);
    const grade = [...chaves].map((k) => {
      const e = esp.get(k);
      const [d, t] = k.split('|');
      const esperado = e?.esperado ?? 0;
      const conferido = conf.get(k) ?? 0;
      return { descricao: e?.descricao ?? d, cor: e?.cor ?? null, tamanho: e?.tamanho ?? (t || '—'), esperado, conferido, falta: Math.max(0, esperado - conferido) };
    }).sort((a, b) => (a.descricao === b.descricao ? a.tamanho.localeCompare(b.tamanho, 'pt', { numeric: true }) : a.descricao.localeCompare(b.descricao)));

    return {
      numero: exp.numero,
      codBip: String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase(), // código da etiqueta MASTER
      esperadas: exp.pecas, conferidas: exp.pecasConferidas,
      status: exp.conferenciaStatus, nf: exp.nf, dataSaida: exp.dataSaida,
      caixas, totalCaixas: caixas.length, caixasConferidas: caixas.filter((c) => c.conferida).length,
      grade,
    };
  }

  /** Bipa uma peça unitária (ou um kit) na conferência de expedição. Idempotente para kits.
   *  Quando `caixaAtual` é informado, a peça bipada é alocada NESSA caixa — o sistema
   *  monta o conteúdo/quantidade de cada caixa conforme a bipagem, sem digitar manualmente. */
  async conferir(id: number, empresaId: number, codigoRaw: string, usuario: string, caixaAtual?: number) {
    const codigo = this.extrairCodigo(codigoRaw);
    if (!codigo) throw new BadRequestException('Bipe um código válido.');
    await this.getExp(id, empresaId); // valida posse (empresa) antes de travar a linha
    // Tudo dentro de uma transação com LOCK da linha da expedição (FOR UPDATE): dois
    // bips concorrentes do MESMO código são serializados — o 2º já vê o 1º gravado e é
    // recusado ("já conferido"), em vez de contar duas vezes.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Expedicao" WHERE id = ${id} FOR UPDATE`;
      const exp = await tx.expedicao.findUnique({ where: { id } });
      if (!exp) throw new NotFoundException(`Expedição ${id} não encontrada.`);
      if (exp.conferenciaStatus === 'despachado') throw new ConflictException('Expedição já despachada — não é possível conferir.');
      const esperadas = exp.pecas;
      const conferidos = ((exp.conferidos as string[] | null) ?? []).slice();
      // Idempotência: cada código único (etiqueta unitária ou kit) conta uma vez.
      if (conferidos.includes(codigo)) {
        return { ja: true, mensagem: `${codigo} já foi conferido.`, conferidas: exp.pecasConferidas, esperadas, status: exp.conferenciaStatus };
      }
      let add = 1;
      let detalhe = codigo;
      let caixasUpd: Prisma.InputJsonValue | undefined;
      let itemInfo: { descricao: string; cor: string | null; tamanho: string | null } | null = null;
      // Conteúdo da caixa CASADO com a linha do pedido (p/ o "Montar caixas" já vir preenchido).
      let boxDescricao: string | null = null;
      let boxCor: string | null = null;
      let boxTam: string | null = null;
      if (/-CX\d+$/i.test(codigo)) {
        // Bipou uma CAIXA: confere todas as peças dela de uma vez.
        const caixas = ((exp.caixas as Array<{ numero: number; pecas: number; conferida?: boolean }> | null) ?? []).slice();
        const prefixo = String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const n = Number(/-CX(\d+)$/i.exec(codigo)?.[1] ?? 0);
        const box = caixas.find((c) => c.numero === n && codigo.toUpperCase() === `${prefixo}-CX${c.numero}`);
        if (!box) throw new NotFoundException(`Caixa ${codigo} não pertence a esta expedição.`);
        add = box.pecas || 0;
        detalhe = `Caixa ${n} (${add} pç)`;
        box.conferida = true;
        caixasUpd = caixas as unknown as Prisma.InputJsonValue;
      } else if (/^KIT-/i.test(codigo)) {
        const kit = await tx.kit.findUnique({ where: { codigo } });
        if (!kit || kit.empresaId !== empresaId) throw new NotFoundException(`Kit ${codigo} não encontrado.`);
        add = kit.jogos || 1; detalhe = `${codigo} (${add} pç)`;
        itemInfo = { descricao: kit.modelo ?? codigo, cor: kit.cor ?? null, tamanho: kit.tamanho ?? null };
      } else {
        // Só conta se a etiqueta resolver numa UNIDADE real — bloqueia leitura grudada,
        // fragmento ou código digitado errado (que antes viravam "peça fantasma").
        const un = await tx.unidadeEstoque.findFirst({ where: { codigo, empresaId } });
        if (!un) throw new BadRequestException(`Etiqueta "${codigo}" não reconhecida. Bipe a etiqueta da peça, do kit ou da caixa.`);

        // ===== NÃO deixa bipar peça FORA do pedido (evita retrabalho) =====
        // Só valida por produto quando o pedido tem itens VINCULADOS a produtos
        // (produtoId). Pedidos de texto livre (ML/importados/soltos) não dá pra
        // validar por código — aí libera a bipagem usando os dados da própria peça.
        const snapItens = (exp.itens as Array<{ produtoId: number | null; descricao?: string; cor: string | null; grade?: Record<string, number> | null }> | null) ?? [];
        if (snapItens.length) {
          const temVinculo = snapItens.some((it) => it.produtoId != null);
          const linha = snapItens.find((it) => it.produtoId === un.produtoId && this.corCombina(it.cor, un.cor));
          if (!linha && temVinculo) {
            throw new BadRequestException(`"${un.descricao ?? codigo}${un.cor ? ' · ' + un.cor : ''}${un.tamanho ? ' · ' + un.tamanho : ''}" não faz parte deste pedido (${exp.numero}). Não bipe peças de fora.`);
          }
          // Casa o conteúdo da caixa com a linha do pedido (ou com a própria peça, se texto livre).
          const tNorm = this.normTamanho(un.tamanho);
          boxDescricao = linha?.descricao ?? un.descricao ?? codigo;
          boxCor = linha?.cor ?? un.cor ?? null;
          boxTam = tNorm;
          if (linha) {
            const pedidoQtd = Object.entries(linha.grade ?? {}).reduce((acc, [k, v]) => (this.normTamanho(k) === tNorm ? acc + Number(v || 0) : acc), 0);
            if (pedidoQtd > 0) {
              const jaTam = (await tx.unidadeEstoque.findMany({ where: { expedicaoId: id, status: 'despachado', produtoId: un.produtoId }, select: { cor: true, tamanho: true } }))
                .filter((x) => this.corCombina(linha.cor, x.cor) && this.normTamanho(x.tamanho) === tNorm).length;
              if (jaTam >= pedidoQtd) {
                throw new BadRequestException(`Tamanho ${tNorm} de "${un.descricao ?? ''}${un.cor ? ' · ' + un.cor : ''}" já está completo (pedido: ${pedidoQtd}). Não bipe a mais.`);
              }
            }
          }
        }

        if (un.status !== 'despachado') {
          await tx.unidadeEstoque.update({ where: { id: un.id }, data: { status: 'despachado', expedicaoId: id, saidaEm: new Date() } });
          detalhe = `${codigo} (baixa estoque)`;
        }
        itemInfo = { descricao: un.descricao ?? codigo, cor: un.cor ?? null, tamanho: un.tamanho ?? null };
      }

      // Alocação por caixa (montagem via bipagem): a peça bipada entra na CAIXA ATUAL,
      // agregando conteúdo (descrição · cor · tamanho) e somando as peças da caixa.
      // Toda peça contada SEMPRE cai numa caixa — se o nº não vier, usa a caixa atual
      // (a última existente) ou a 1 — assim a soma das caixas nunca diverge do total.
      if (!/-CX\d+$/i.test(codigo)) {
        type Cx = { numero: number; pecas: number; conteudo?: CaixaLinha[]; codigos?: string[]; peso?: number | null; conferida?: boolean; viaBip?: boolean };
        const cx = ((exp.caixas as Cx[] | null) ?? []).slice();
        const nCaixa = Math.floor(Number(caixaAtual) || 0) || (cx.length ? Math.max(...cx.map((c) => c.numero)) : 1);
        let box = cx.find((c) => c.numero === nCaixa);
        if (!box) { box = { numero: nCaixa, pecas: 0, conteudo: [], codigos: [], viaBip: true }; cx.push(box); }
        box.conteudo = box.conteudo ?? [];
        box.codigos = box.codigos ?? [];
        // Preferir a descrição/cor/tamanho da LINHA DO PEDIDO (casa com o "Montar caixas").
        const d = boxDescricao ?? itemInfo?.descricao ?? codigo;
        const co = boxCor ?? itemInfo?.cor ?? null;
        const ta = boxTam ?? (itemInfo ? this.normTamanho(itemInfo.tamanho) : null);
        const linha = box.conteudo.find((l) => (l.descricao ?? '') === (d ?? '') && (l.cor ?? '') === (co ?? '') && (l.tamanho ?? '') === (ta ?? ''));
        if (linha) linha.qtd = (linha.qtd ?? 0) + add; else box.conteudo.push({ descricao: d, cor: co, tamanho: ta, qtd: add });
        box.pecas = (box.pecas ?? 0) + add;
        box.codigos.push(codigo);
        box.viaBip = true;
        cx.sort((a, b) => a.numero - b.numero);
        caixasUpd = cx as unknown as Prisma.InputJsonValue;
        detalhe += ` → Caixa ${nCaixa}`;
      }

      conferidos.push(codigo);
      const novas = Math.min(esperadas, exp.pecasConferidas + add);
      const completou = novas >= esperadas;
      await tx.expedicao.update({
        where: { id },
        data: { pecasConferidas: novas, conferidos, conferenciaStatus: completou ? 'conferida' : 'conferindo', conferidoPor: usuario, ...(completou ? { conferidoEm: new Date() } : {}), ...(caixasUpd ? { caixas: caixasUpd } : {}) },
      });
      return {
        ja: false,
        mensagem: completou ? `Conferência concluída! ${novas}/${esperadas}. Libere a etiqueta master e despache.` : `Conferido: ${detalhe}. ${novas}/${esperadas}.`,
        conferidas: novas, esperadas, status: completou ? 'conferida' : 'conferindo', completou,
      };
    });
  }

  /** Zera a conferência: reverte as unidades bipadas (voltam ao estoque) e limpa as
   *  caixas montadas por bipagem — p/ recomeçar a conferência do zero. */
  async zerarConferencia(id: number, empresaId: number) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') throw new ConflictException('Expedição já despachada — não é possível zerar a conferência.');
    await this.prisma.unidadeEstoque.updateMany({ where: { expedicaoId: id, status: 'despachado' }, data: { status: 'reservado', expedicaoId: null, saidaEm: null } });
    // Mantém caixas montadas MANUALMENTE (não via bipagem); as viaBip são recriadas ao rebipar.
    const caixas = ((exp.caixas as Array<{ viaBip?: boolean }> | null) ?? []).filter((c) => !c.viaBip);
    await this.prisma.expedicao.update({
      where: { id },
      data: { pecasConferidas: 0, conferidos: [], conferenciaStatus: 'pendente', conferidoPor: null, conferidoEm: null, caixas: caixas as unknown as Prisma.InputJsonValue },
    });
    return { ok: true, mensagem: 'Conferência zerada. Bipe novamente do início.' };
  }

  /** Zera UMA caixa: devolve só as peças dela ao estoque e some com a caixa, mantendo as demais. */
  async zerarCaixa(id: number, empresaId: number, numeroCaixa: number) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') throw new ConflictException('Expedição já despachada — não é possível alterar as caixas.');
    type Cx = { numero: number; pecas: number; conteudo?: CaixaLinha[]; codigos?: string[]; viaBip?: boolean; conferida?: boolean };
    const caixas = ((exp.caixas as Cx[] | null) ?? []).slice().sort((a, b) => a.numero - b.numero);
    const idx = caixas.findIndex((c) => c.numero === numeroCaixa);
    if (idx < 0) throw new NotFoundException(`Caixa ${numeroCaixa} não encontrada nesta expedição.`);
    const box = caixas[idx];
    const conferidos = ((exp.conferidos as string[] | null) ?? []).slice();
    // Códigos da caixa: usa os gravados; caixa antiga (sem `codigos`) → reconstrói pela
    // fatia sequencial de `conferidos` (assume que as caixas foram preenchidas em ordem).
    let codigos = box.codigos ?? [];
    if (!codigos.length && (box.pecas || 0) > 0) {
      const offset = caixas.slice(0, idx).reduce((s, c) => s + (c.pecas || 0), 0);
      codigos = conferidos.slice(offset, offset + (box.pecas || 0));
    }
    if (codigos.length) {
      await this.prisma.unidadeEstoque.updateMany({ where: { codigo: { in: codigos }, expedicaoId: id, status: 'despachado' }, data: { status: 'reservado', expedicaoId: null, saidaEm: null } });
    }
    const rem = new Set(codigos);
    const novosConferidos = conferidos.filter((c) => !rem.has(c));
    const novasCaixas = caixas.filter((c) => c.numero !== numeroCaixa);
    const novasPecas = Math.max(0, (exp.pecasConferidas || 0) - (box.pecas || 0));
    await this.prisma.expedicao.update({
      where: { id },
      data: {
        caixas: novasCaixas as unknown as Prisma.InputJsonValue,
        conferidos: novosConferidos,
        pecasConferidas: novasPecas,
        conferenciaStatus: novasPecas >= exp.pecas ? 'conferida' : novasPecas > 0 ? 'conferindo' : 'pendente',
        ...(novasPecas < exp.pecas ? { conferidoEm: null } : {}),
      },
    });
    return { ok: true, mensagem: `Caixa ${numeroCaixa} zerada — ${box.pecas || 0} peça(s) devolvida(s) ao estoque.`, conferidas: novasPecas };
  }

  /** Admin: conclui a conferência SEM bipar peça a peça — mas NÃO despacha.
   *  Fica "conferida"; o despacho (com a data de saída correta) é um passo à parte. */
  async conferirSemBip(id: number, empresaId: number) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') throw new ConflictException('Expedição já despachada.');
    await this.prisma.expedicao.update({ where: { id }, data: { conferenciaStatus: 'conferida', pecasConferidas: exp.pecas } });
    return { ok: true, mensagem: 'Conferência concluída (sem bipar). Agora bipe a etiqueta MASTER para despachar e registrar a data de saída.' };
  }

  /** Despacha a mercadoria (só após a conferência): registra a data de saída ao cliente.
   *  A saída é liberada bipando a ETIQUETA MASTER da caixa (codigoMaster) — 2ª leitura da dupla conferência. */
  async despachar(id: number, empresaId: number, usuario: string, codigoMaster?: string, forcar = false) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') return { ja: true, mensagem: 'Expedição já despachada.', dataSaida: exp.dataSaida };
    // Baixa direta do admin: marca tudo conferido e pula a 2ª leitura (etiqueta master).
    if (forcar) {
      if (exp.conferenciaStatus !== 'conferida') {
        await this.prisma.expedicao.update({ where: { id }, data: { conferenciaStatus: 'conferida', pecasConferidas: exp.pecas } });
      }
      codigoMaster = undefined;
    } else if (exp.conferenciaStatus !== 'conferida') {
      throw new ConflictException(`Conclua a conferência (${exp.pecasConferidas}/${exp.pecas}) antes de despachar.`);
    }
    // 2ª leitura: exige a etiqueta MASTER correta desta expedição.
    if (codigoMaster != null) {
      const master = String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const bip = this.extrairCodigo(codigoMaster).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (!bip) throw new BadRequestException('Bipe a etiqueta MASTER da caixa para despachar.');
      if (bip !== master) throw new BadRequestException(`Etiqueta master incorreta (${bip}). Bipe a etiqueta master desta expedição (${exp.numero}).`);
    }
    const now = new Date();
    await this.prisma.expedicao.update({ where: { id }, data: { conferenciaStatus: 'despachado', status: 'Despachado', dataSaida: now, despachadoPor: usuario } });
    // Saiu pra entrega: define a etapa do pedido conforme o que já foi expedido.
    // Só marca CONCLUÍDO quando TODOS os itens foram totalmente expedidos e não há
    // mais expedições pendentes; caso contrário fica PARCIAL (falta expedir o resto).
    if (exp.pedidoId) {
      const pendentes = await this.prisma.expedicao.count({ where: { pedidoId: exp.pedidoId, id: { not: id }, conferenciaStatus: { not: 'despachado' } } });
      const itens = await this.prisma.pedidoItem.findMany({ where: { pedidoId: exp.pedidoId }, select: { quantidade: true, quantidadeExpedida: true } });
      const tudoExpedido = itens.length > 0 && itens.every((i) => (i.quantidadeExpedida ?? 0) >= i.quantidade);
      if (pendentes === 0 && tudoExpedido) {
        await this.prisma.pedido.update({ where: { id: exp.pedidoId }, data: { etapa: 'concluido', status: 'Concluído' } }).catch(() => undefined);
      } else {
        await this.prisma.pedido.update({ where: { id: exp.pedidoId }, data: { etapa: 'parcial', status: 'Expedição parcial' } }).catch(() => undefined);
      }
    }
    return { ja: false, mensagem: 'Mercadoria DESPACHADA. Data de saída registrada.', dataSaida: now };
  }

  /**
   * ESTORNA a expedição (volta a operação pro pedido de venda): reverte as
   * quantidades expedidas dos itens, apaga a expedição e devolve o pedido para
   * ser reexpedido (ex.: mandar só parcial). Bloqueia se já despachada.
   */
  async estornar(id: number, empresaId: number) {
    const exp = await this.getExp(id, empresaId);
    if (exp.conferenciaStatus === 'despachado') {
      throw new ConflictException(`Expedição ${exp.numero} já foi despachada — não é possível voltar pro pedido.`);
    }
    const itens = (exp.itens as Array<{ pedidoItemId?: number; quantidade?: number; grade?: Record<string, number> | null }> | null) ?? [];
    await this.prisma.$transaction(async (tx) => {
      for (const s of itens) {
        if (!s.pedidoItemId) continue;
        const it = await tx.pedidoItem.findUnique({ where: { id: s.pedidoItemId } });
        if (!it) continue;
        let novaGrade: Record<string, number> | undefined;
        if (s.grade) {
          const jaG = (it.gradeExpedida as Record<string, number> | null) ?? {};
          novaGrade = { ...jaG };
          for (const [t, q] of Object.entries(s.grade)) novaGrade[t] = Math.max(0, Number(novaGrade[t] ?? 0) - Number(q));
        }
        const novaQtd = Math.max(0, (it.quantidadeExpedida ?? 0) - Number(s.quantidade || 0));
        await tx.pedidoItem.update({
          where: { id: s.pedidoItemId },
          data: { quantidadeExpedida: novaQtd, ...(novaGrade ? { gradeExpedida: novaGrade as unknown as Prisma.InputJsonValue } : {}) },
        });
      }
      await tx.expedicao.delete({ where: { id } });
      if (exp.pedidoId) {
        const restam = await tx.expedicao.count({ where: { pedidoId: exp.pedidoId } });
        await tx.pedido.update({
          where: { id: exp.pedidoId },
          data: restam ? { status: 'Expedição parcial' } : { etapa: 'estoque', status: 'Pronto para expedição' },
        });
      }
    });
    return { ok: true, mensagem: `Expedição ${exp.numero} estornada — pedido liberado para reexpedir (parcial ou total).` };
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
