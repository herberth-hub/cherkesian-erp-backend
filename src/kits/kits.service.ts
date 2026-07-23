import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Kit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AlterarLoteKitDto,
  AtribuirCaixaDto,
  BiparKitDto,
  CreateLoteDto,
  CriarKitsDeOpDto,
  ExpedirKitDto,
  RetornarKitDto,
} from './dto/kits.dto';

/** Máquina de estados do KIT (PRD). */
const FLUXO = ['criado', 'em_corte', 'aguardando_expedicao', 'em_faccao', 'retornado', 'em_conferencia', 'finalizado'] as const;

@Injectable()
export class KitsService {
  constructor(private readonly prisma: PrismaService) {}

  // ===================== LOTES DE TECIDO =====================
  listarLotes(empresaId: number) {
    return this.prisma.loteTecido.findMany({ where: { empresaId }, orderBy: { id: 'desc' } });
  }

  async criarLote(dto: CreateLoteDto, empresaId: number, usuario: string) {
    const existe = await this.prisma.loteTecido.findFirst({ where: { empresaId, codigoLote: dto.codigoLote } });
    if (existe) throw new ConflictException(`Lote ${dto.codigoLote} já cadastrado.`);
    return this.prisma.loteTecido.create({
      data: {
        empresaId,
        codigoLote: dto.codigoLote.trim(),
        materialId: dto.materialId,
        codigoTecido: dto.codigoTecido,
        descricaoTecido: dto.descricaoTecido,
        corTecido: dto.corTecido,
        fornecedorId: dto.fornecedorId,
        fornecedorNome: dto.fornecedorNome,
        nfCompra: dto.nfCompra,
        dataRecebimento: dto.dataRecebimento ? new Date(dto.dataRecebimento) : undefined,
        criadoPor: usuario,
      },
    });
  }

  // ===================== KITS =====================
  listar(empresaId: number, status?: string) {
    return this.prisma.kit.findMany({
      where: { empresaId, ...(status ? { status } : {}) },
      include: { lote: { select: { codigoLote: true, nfCompra: true } } },
      orderBy: { id: 'desc' },
      take: 500,
    });
  }

  async detalhe(id: number, empresaId: number) {
    const kit = await this.prisma.kit.findUnique({
      where: { id },
      include: { lote: true, eventos: { orderBy: { id: 'desc' } } },
    });
    if (!kit || kit.empresaId !== empresaId) throw new NotFoundException(`Kit ${id} não encontrado.`);
    return kit;
  }

  /** Busca por múltiplos campos (número, pedido, cliente, modelo, cor, tamanho, facção, lote...). */
  async buscar(empresaId: number, q: string) {
    const termo = (q ?? '').trim();
    if (!termo) return [];
    const cod = this.extrairCodigo(termo);
    return this.prisma.kit.findMany({
      where: {
        empresaId,
        OR: [
          { codigo: { contains: cod, mode: 'insensitive' } },
          { clienteNome: { contains: termo, mode: 'insensitive' } },
          { modelo: { contains: termo, mode: 'insensitive' } },
          { variante: { contains: termo, mode: 'insensitive' } },
          { cor: { contains: termo, mode: 'insensitive' } },
          { tamanho: { equals: termo, mode: 'insensitive' } },
          { faccaoNome: { contains: termo, mode: 'insensitive' } },
          { ordemProducao: { contains: termo, mode: 'insensitive' } },
          { ordemCorte: { contains: termo, mode: 'insensitive' } },
          { enfesto: { contains: termo, mode: 'insensitive' } },
          { lote: { codigoLote: { contains: termo, mode: 'insensitive' } } },
          { lote: { codigoTecido: { contains: termo, mode: 'insensitive' } } },
          { lote: { nfCompra: { contains: termo, mode: 'insensitive' } } },
        ],
      },
      include: { lote: { select: { codigoLote: true } } },
      orderBy: { id: 'desc' },
      take: 300,
    });
  }

  /** Consulta por lote: todos os kits + resumo (produzidos/retornados/pendentes). */
  async porLote(empresaId: number, codigoLote: string) {
    const lote = await this.prisma.loteTecido.findFirst({ where: { empresaId, codigoLote } });
    if (!lote) throw new NotFoundException(`Lote ${codigoLote} não encontrado.`);
    const kits = await this.prisma.kit.findMany({ where: { empresaId, loteTecidoId: lote.id }, orderBy: { id: 'desc' } });
    const resumo = {
      totalKits: kits.length,
      pecas: kits.reduce((s, k) => s + k.pecasTotal, 0),
      emFaccao: kits.filter((k) => k.status === 'em_faccao').length,
      retornados: kits.filter((k) => ['retornado', 'em_conferencia', 'finalizado'].includes(k.status)).length,
      pendentesExpedicao: kits.filter((k) => k.status === 'aguardando_expedicao').length,
      pedidos: [...new Set(kits.map((k) => k.pedidoId).filter(Boolean))],
      faccoes: [...new Set(kits.map((k) => k.faccaoNome).filter(Boolean))],
    };
    return { lote, resumo, kits };
  }

  /**
   * Gera os KITS de uma OP: um por TAMANHO da grade, com a qtd cortada de cada
   * tamanho, vinculando obrigatoriamente ao LOTE do tecido (rastreabilidade).
   */
  async criarDeOp(dto: CriarKitsDeOpDto, empresaId: number, usuario: string) {
    const op = await this.prisma.oP.findUnique({
      where: { id: dto.opId },
      include: { pedido: { select: { empresaId: true, numero: true, obs: true, cliente: { select: { nome: true } } } } },
    });
    if (!op || op.pedido?.empresaId !== empresaId) throw new NotFoundException(`OP ${dto.opId} não encontrada.`);

    const lote = await this.prisma.loteTecido.findUnique({ where: { id: dto.loteTecidoId } });
    if (!lote || lote.empresaId !== empresaId) throw new NotFoundException(`Lote ${dto.loteTecidoId} não encontrado.`);

    const grade = (op.gradeTamanhos as Record<string, number> | null) ?? {};
    const tamanhos = Object.entries(grade).filter(([, q]) => Number(q) > 0);
    if (!tamanhos.length) {
      throw new BadRequestException('A OP não tem grade de tamanhos definida. Defina a grade (ex.: PP:8, M:2, G:2) antes de gerar os kits.');
    }
    // Evita duplicar kits da mesma OP.
    const jaTem = await this.prisma.kit.count({ where: { empresaId, opId: op.id } });
    if (jaTem > 0) throw new ConflictException(`A OP ${op.numero} já possui ${jaTem} kit(s) gerado(s).`);

    const produto = op.produtoId ? await this.prisma.produto.findUnique({ where: { id: op.produtoId }, select: { descricao: true } }) : null;
    const corMatch = /cor\s*:\s*([^·|\n]+)/i.exec(op.pedido?.obs ?? '');
    const cor = dto.cor?.trim() || (corMatch ? corMatch[1].trim() : undefined);
    const pecasPorJogo = dto.pecasPorJogo && dto.pecasPorJogo > 0 ? dto.pecasPorJogo : 1;
    const agora = new Date();

    const criados: Kit[] = [];
    for (const [tamanho, qtd] of tamanhos) {
      const jogos = Number(qtd);
      const codigo = await this.proximoCodigoKit(agora);
      const kit = await this.prisma.kit.create({
        data: {
          empresaId,
          codigo,
          pedidoId: op.pedidoId,
          opId: op.id,
          loteTecidoId: lote.id,
          clienteNome: op.pedido?.cliente?.nome,
          modelo: produto?.descricao,
          cor,
          tamanho: tamanho.toUpperCase(),
          jogos,
          pecasTotal: jogos * pecasPorJogo,
          ordemProducao: op.numero,
          ordemCorte: dto.ordemCorte,
          enfesto: dto.enfesto,
          mesaCorte: dto.mesaCorte,
          operadorCorte: dto.operadorCorte || usuario,
          dataCorte: agora,
          faccaoId: dto.faccaoId,
          faccaoNome: dto.faccaoNome,
          caixa: dto.caixa,
          status: 'aguardando_expedicao',
          criadoPor: usuario,
          eventos: { create: { empresaId, evento: 'criado', detalhe: `Kit ${tamanho} · ${jogos} jogo(s) · lote ${lote.codigoLote}`, usuario } },
        },
      });
      criados.push(kit);
    }
    return { op: op.numero, lote: lote.codigoLote, total: criados.length, kits: criados };
  }

  // ===================== EXPEDIÇÃO / RETORNO (idempotentes) =====================
  async expedir(dto: ExpedirKitDto, empresaId: number, usuario: string, ip?: string) {
    const kit = await this.acharPorCodigo(dto.codigo, empresaId);
    if (kit.status === 'em_faccao') {
      return { ja: true, mensagem: `Kit ${kit.codigo} já expedido em ${this.fmt(kit.expedidoEm)} por ${kit.expedidoPor ?? '—'}.`, kit };
    }
    if (kit.status !== 'aguardando_expedicao') {
      throw new ConflictException(`Kit ${kit.codigo} não pode ser expedido (status atual: ${kit.status}).`);
    }
    const atualizado = await this.prisma.$transaction(async (tx) => {
      const k = await tx.kit.update({
        where: { id: kit.id },
        data: {
          status: 'em_faccao',
          expedidoEm: new Date(),
          expedidoPor: usuario,
          faccaoNome: dto.faccaoNome ?? kit.faccaoNome,
          transportador: dto.transportador,
          remessaNfNumero: dto.remessaNf ?? kit.remessaNfNumero,
          obs: dto.obs ?? kit.obs,
        },
      });
      await tx.kitEvento.create({ data: { empresaId, kitId: kit.id, evento: 'expedido', detalhe: `Facção: ${k.faccaoNome ?? '—'}${dto.remessaNf ? ' · NF remessa: ' + dto.remessaNf : ''}${dto.transportador ? ' · Transp.: ' + dto.transportador : ''}`, usuario, ip } });
      return k;
    });
    return { ja: false, mensagem: `Kit ${kit.codigo} expedido para ${atualizado.faccaoNome ?? 'facção'}.`, kit: atualizado };
  }

  async retornar(dto: RetornarKitDto, empresaId: number, usuario: string, ip?: string) {
    const kit = await this.acharPorCodigo(dto.codigo, empresaId);
    if (['retornado', 'em_conferencia', 'finalizado'].includes(kit.status)) {
      return { ja: true, mensagem: `Este KIT já foi recebido em ${this.fmt(kit.retornadoEm)} por ${kit.retornadoPor ?? '—'}.`, kit };
    }
    if (kit.status !== 'em_faccao') {
      throw new ConflictException(`Retorno sem saída: o kit ${kit.codigo} não está em facção (status: ${kit.status}).`);
    }
    const atualizado = await this.prisma.$transaction(async (tx) => {
      const k = await tx.kit.update({
        where: { id: kit.id },
        data: { status: 'retornado', retornadoEm: new Date(), retornadoPor: usuario, qtdRetornada: dto.qtd ?? kit.jogos, retornoNfNumero: dto.retornoNf, obs: dto.obs ?? kit.obs },
      });
      await tx.kitEvento.create({ data: { empresaId, kitId: kit.id, evento: 'retornado', detalhe: `NF retorno: ${dto.retornoNf} · Qtd: ${dto.qtd ?? kit.jogos}${dto.obs ? ' · ' + dto.obs : ''}`, usuario, ip } });
      return k;
    });
    return { ja: false, mensagem: `Kit ${kit.codigo} retornado da facção.`, kit: atualizado };
  }

  /** Avança para conferência ou finaliza (bipagem). */
  async avancar(dto: BiparKitDto, empresaId: number, alvo: 'em_conferencia' | 'finalizado', usuario: string, ip?: string) {
    const kit = await this.acharPorCodigo(dto.codigo, empresaId);
    if (kit.status === alvo) return { ja: true, mensagem: `Kit ${kit.codigo} já está em ${alvo}.`, kit };
    const permitido = alvo === 'em_conferencia' ? kit.status === 'retornado' : kit.status === 'em_conferencia' || kit.status === 'retornado';
    if (!permitido) throw new ConflictException(`Kit ${kit.codigo} não pode ir para ${alvo} (status: ${kit.status}).`);
    const k = await this.prisma.kit.update({ where: { id: kit.id }, data: { status: alvo } });
    await this.prisma.kitEvento.create({ data: { empresaId, kitId: kit.id, evento: alvo === 'em_conferencia' ? 'conferido' : 'finalizado', usuario, ip } });
    return { ja: false, mensagem: `Kit ${kit.codigo} → ${alvo}.`, kit: k };
  }

  /** Altera o lote do tecido de um kit (auditado). Bloqueado após a expedição. */
  async alterarLote(id: number, dto: AlterarLoteKitDto, empresaId: number, usuario: string, ip?: string) {
    const kit = await this.detalhe(id, empresaId);
    if (!['criado', 'em_corte', 'aguardando_expedicao'].includes(kit.status)) {
      throw new ConflictException('Não é permitido alterar o lote após a expedição do kit.');
    }
    const novo = await this.prisma.loteTecido.findUnique({ where: { id: dto.loteTecidoId } });
    if (!novo || novo.empresaId !== empresaId) throw new NotFoundException('Lote informado não encontrado.');
    const anterior = kit.lote?.codigoLote ?? '—';
    const k = await this.prisma.kit.update({ where: { id }, data: { loteTecidoId: dto.loteTecidoId } });
    await this.prisma.kitEvento.create({
      data: { empresaId, kitId: id, evento: 'lote_alterado', detalhe: `De ${anterior} para ${novo.codigoLote}. Motivo: ${dto.motivo}`, usuario, ip },
    });
    return k;
  }

  // ===================== CAIXAS =====================
  /** Atribui uma caixa de armazenamento a um conjunto de kits (do mesmo pedido). */
  async atribuirCaixa(dto: AtribuirCaixaDto, empresaId: number, usuario: string) {
    const kits = await this.prisma.kit.findMany({ where: { id: { in: dto.kitIds }, empresaId } });
    if (kits.length !== dto.kitIds.length) throw new NotFoundException('Um ou mais kits não foram encontrados.');
    const pedidos = new Set(kits.map((k) => k.pedidoId));
    if (pedidos.size > 1) throw new ConflictException('Uma caixa deve conter kits de um único pedido.');
    await this.prisma.$transaction(async (tx) => {
      await tx.kit.updateMany({ where: { id: { in: dto.kitIds } }, data: { caixa: dto.caixa.trim() } });
      for (const k of kits) await tx.kitEvento.create({ data: { empresaId, kitId: k.id, evento: 'caixa', detalhe: `Caixa ${dto.caixa}`, usuario } });
    });
    return { caixa: dto.caixa, kits: dto.kitIds.length };
  }

  /** Kits agrupados por caixa (para conferência física). */
  async porCaixa(empresaId: number) {
    const kits = await this.prisma.kit.findMany({ where: { empresaId, caixa: { not: null } }, orderBy: [{ caixa: 'asc' }, { tamanho: 'asc' }] });
    const map = new Map<string, typeof kits>();
    for (const k of kits) { const c = k.caixa as string; const arr = map.get(c) ?? []; arr.push(k); map.set(c, arr); }
    return [...map.entries()].map(([caixa, ks]) => ({
      caixa,
      pedidoId: ks[0].pedidoId,
      cliente: ks[0].clienteNome,
      totalKits: ks.length,
      pecas: ks.reduce((s, k) => s + k.pecasTotal, 0),
      tamanhos: ks.map((k) => `${k.tamanho}(${k.jogos})`).join(' '),
      kits: ks.map((k) => ({ id: k.id, codigo: k.codigo, tamanho: k.tamanho, jogos: k.jogos, status: k.status })),
    }));
  }

  // ===================== DASHBOARD =====================
  async dashboard(empresaId: number) {
    const kits = await this.prisma.kit.findMany({ where: { empresaId }, select: { status: true, faccaoNome: true, retornadoEm: true, pecasTotal: true } });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const porStatus: Record<string, number> = {};
    const porFaccao: Record<string, number> = {};
    let retornadosHoje = 0, pecas = 0;
    for (const k of kits) {
      porStatus[k.status] = (porStatus[k.status] ?? 0) + 1;
      if (k.faccaoNome && k.status === 'em_faccao') porFaccao[k.faccaoNome] = (porFaccao[k.faccaoNome] ?? 0) + 1;
      if (k.retornadoEm && new Date(k.retornadoEm) >= hoje) retornadosHoje++;
      pecas += k.pecasTotal;
    }
    return {
      totalKits: kits.length,
      pecas,
      aguardandoExpedicao: porStatus['aguardando_expedicao'] ?? 0,
      emFaccao: porStatus['em_faccao'] ?? 0,
      retornadosHoje,
      finalizados: porStatus['finalizado'] ?? 0,
      porStatus,
      porFaccao,
    };
  }

  // ===================== ETIQUETA ZEBRA (QR + Code128) =====================
  async etiqueta(id: number, empresaId: number) {
    const kit = await this.detalhe(id, empresaId);
    return { dados: this.dadosEtiqueta(kit), zpl: this.montarZpl(kit) };
  }

  private dadosEtiqueta(kit: Kit & { lote?: { codigoLote: string } | null }) {
    return {
      codigo: kit.codigo,
      pedido: kit.pedidoId ? String(kit.pedidoId) : '—',
      cliente: kit.clienteNome ?? '—',
      modelo: kit.modelo ?? '—',
      cor: kit.cor ?? '—',
      tamanho: kit.tamanho,
      jogos: kit.jogos,
      pecas: kit.pecasTotal,
      lote: kit.lote?.codigoLote ?? '—',
      enfesto: kit.enfesto ?? '—',
      oc: kit.ordemCorte ?? '—',
      op: kit.ordemProducao ?? '—',
      destino: kit.faccaoNome ?? '—',
    };
  }

  /** QR (JSON compacto) + Code128 do código do kit; etiqueta ~100x70mm @203dpi. */
  private montarZpl(kit: Kit & { lote?: { codigoLote: string } | null }): string {
    const d = this.dadosEtiqueta(kit);
    const s = (v: string | number) => String(v).replace(/[\^~]/g, ' ').slice(0, 30);
    const qr = JSON.stringify({
      kit: kit.codigo, pedido: d.pedido, cliente: d.cliente, modelo: d.modelo,
      cor: d.cor, tam: d.tamanho, jogos: d.jogos, pecas: d.pecas, lote: d.lote,
      enfesto: d.enfesto, oc: d.oc, versao: '1',
    }).replace(/[\^~]/g, ' ');
    return [
      '^XA', '^CI28', '^PW800', '^LL560',
      '^CF0,30', '^FO20,18^FDGRUPO CHERKESIAN^FS',
      '^CF0,44', `^FO20,54^FD${s(kit.codigo)}^FS`,
      '^CF0,26',
      `^FO20,110^FDPedido: ${s(d.pedido)}  Cliente: ${s(d.cliente)}^FS`,
      `^FO20,144^FDModelo: ${s(d.modelo)}^FS`,
      `^FO20,178^FDCor: ${s(d.cor)}   TAM: ${s(d.tamanho)}^FS`,
      '^CF0,40', `^FO20,212^FDTAMANHO ${s(d.tamanho)}  |  ${d.jogos} JOGOS / ${d.pecas} PECAS^FS`,
      '^CF0,26',
      `^FO20,266^FDLote: ${s(d.lote)}  Enfesto: ${s(d.enfesto)}^FS`,
      `^FO20,300^FDOC: ${s(d.oc)}  OP: ${s(d.op)}^FS`,
      `^FO20,334^FDDESTINO: ${s(d.destino)}^FS`,
      // QR Code (grande) à direita
      `^FO560,110^BQN,2,6^FDLA,${qr}^FS`,
      // Code128 do código do kit na base
      `^FO20,400^BY2^BCN,90,Y,N,N^FD${s(kit.codigo)}^FS`,
      '^XZ',
    ].join('\n');
  }

  // ===================== Helpers =====================
  private async proximoCodigoKit(agora: Date): Promise<string> {
    const ymd = agora.toISOString().slice(0, 10).replace(/-/g, '');
    const doDia = await this.prisma.kit.count({ where: { codigo: { startsWith: `KIT-${ymd}-` } } });
    return `KIT-${ymd}-${String(doDia + 1).padStart(6, '0')}`;
  }

  /** Extrai o código do kit de um input que pode ser o QR (JSON) ou o próprio código. */
  private extrairCodigo(input: string): string {
    const t = (input ?? '').trim();
    if (t.startsWith('{')) {
      try { return String(JSON.parse(t).kit ?? '').trim() || t; } catch { return t; }
    }
    return t;
  }

  private async acharPorCodigo(input: string, empresaId: number): Promise<Kit> {
    const codigo = this.extrairCodigo(input);
    const kit = await this.prisma.kit.findUnique({ where: { codigo } });
    if (!kit || kit.empresaId !== empresaId) throw new NotFoundException(`Kit "${codigo}" não encontrado.`);
    return kit;
  }

  private fmt(d?: Date | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR');
  }
}
