import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MovimentarEstoqueDto } from './dto/movimentar.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js') as { toBuffer: (opts: Record<string, unknown>) => Promise<Buffer> };

@Injectable()
export class EstoqueService {
  constructor(private readonly prisma: PrismaService) {}

  // ===================== ESTOQUE UNITÁRIO (etiqueta por peça + endereço) =====================
  /**
   * ENTRADA: cria N unidades (uma etiqueta única por peça) para estocar ou ir
   * direto à expedição. Retorna as unidades com código de barras p/ impressão.
   */
  async entrada(dto: {
    tipo: string; produtoId?: number; materialId?: number; descricao?: string; ref?: string; cor?: string; tamanho?: string;
    quantidade: number; destino?: 'estoque' | 'expedicao'; coluna?: string; andar?: string; caixaMaster?: string;
    pedidoId?: number; origem?: string; loteFornecedor?: string; loteEntrada?: string;
  }, empresaId: number, usuario: string) {
    const qtd = Math.floor(Number(dto.quantidade));
    if (!qtd || qtd < 1) throw new BadRequestException('Informe a quantidade (>= 1).');
    if (qtd > 500) throw new BadRequestException('Máximo de 500 unidades por entrada.');

    // Descrição + REF (código do produto/material) — vão na etiqueta.
    let descricao = dto.descricao;
    let ref = dto.ref ?? '';
    if (dto.produtoId) {
      const p = await this.prisma.produto.findUnique({ where: { id: dto.produtoId } });
      if (!p || p.empresaId !== empresaId) throw new NotFoundException(`Produto ${dto.produtoId} não encontrado.`);
      descricao = descricao ?? p.descricao;
      ref = ref || p.codigo;
    } else if (dto.materialId) {
      const m = await this.prisma.material.findUnique({ where: { id: dto.materialId } });
      if (!m || m.empresaId !== empresaId) throw new NotFoundException(`Material ${dto.materialId} não encontrado.`);
      descricao = descricao ?? m.descricao;
      ref = ref || m.codigo;
    }
    if (!descricao) throw new BadRequestException('Informe a descrição do item (ou selecione um produto/material).');

    const paraExpedicao = dto.destino === 'expedicao';
    const status = paraExpedicao ? 'reservado' : (dto.coluna && dto.andar != null && dto.caixaMaster ? 'em_estoque' : 'aguardando_endereco');
    const agora = new Date();
    const ymd = agora.toISOString().slice(0, 10).replace(/-/g, '');
    const base = await this.prisma.unidadeEstoque.count({ where: { codigo: { startsWith: `UN-${ymd}-` } } });
    // Etiqueta de lote: usa a informada (ex.: OP-123 p/ reimpressão por OP) ou gera automática.
    const loteEntrada = (dto.loteEntrada || '').trim() || `ENT-${ymd}-${String(base + 1).padStart(4, '0')}`;

    const criadas: Array<{ codigo: string }> = [];
    for (let i = 0; i < qtd; i++) {
      const codigo = `UN-${ymd}-${String(base + 1 + i).padStart(6, '0')}`;
      await this.prisma.unidadeEstoque.create({
        data: {
          empresaId, codigo, tipo: dto.tipo, produtoId: dto.produtoId, materialId: dto.materialId,
          descricao, cor: dto.cor, tamanho: dto.tamanho, origem: dto.origem ?? 'entrada',
          coluna: dto.coluna, andar: dto.andar, caixaMaster: dto.caixaMaster, status,
          pedidoId: paraExpedicao ? dto.pedidoId : undefined, loteEntrada, loteFornecedor: dto.loteFornecedor || null, criadoPor: usuario,
        },
      });
      criadas.push({ codigo });
    }
    // Gera as etiquetas (código de barras) das unidades criadas.
    const pecas = [];
    for (const c of criadas) {
      const bc = await bwipjs.toBuffer({ bcid: 'code128', text: c.codigo, scale: 2, height: 12, includetext: false, padding: 0 });
      pecas.push({ codigo: c.codigo, ref, descricao, cor: dto.cor ?? '', tamanho: dto.tamanho ?? '', loteFornecedor: dto.loteFornecedor ?? '', barcode: 'data:image/png;base64,' + bc.toString('base64') });
    }
    return { loteEntrada, total: qtd, destino: dto.destino ?? 'estoque', status, endereco: this.enderecoTxt(dto), pecas };
  }

  private enderecoTxt(d: { coluna?: string; andar?: string; caixaMaster?: string }): string | null {
    if (!d.coluna && d.andar == null && !d.caixaMaster) return null;
    return `Coluna ${d.coluna ?? '—'} · Andar ${d.andar ?? '—'} · Caixa ${d.caixaMaster ?? '—'}`;
  }

  /** Endereça uma unidade (bipada) no armazém. Se já estiver endereçada em OUTRO
   *  lugar, NÃO troca sem confirmar: devolve `precisaConfirmar` com o endereço atual. */
  async enderecar(dto: { codigo: string; coluna: string; andar: string; caixaMaster: string; confirmar?: boolean }, empresaId: number, usuario: string) {
    const codigo = (dto.codigo ?? '').trim();
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo } });
    if (!un || un.empresaId !== empresaId) throw new NotFoundException(`Unidade ${codigo} não encontrada.`);
    if (un.status === 'despachado') throw new BadRequestException('Unidade já despachada.');

    const fmt = (c?: string | null, a?: string | null, x?: string | null) => `Coluna ${c ?? '—'} · Andar ${a != null ? a : '—'} · Caixa ${x ?? '—'}`;
    const jaEnderecado = un.status === 'em_estoque' && (un.coluna != null || un.andar != null || un.caixaMaster != null);
    const mudou = un.coluna !== dto.coluna || un.andar !== dto.andar || un.caixaMaster !== dto.caixaMaster;
    // Já está EXATAMENTE neste endereço → não duplica, só avisa.
    if (jaEnderecado && !mudou) {
      return { jaAqui: true, codigo, descricao: un.descricao, tamanho: un.tamanho, endereco: fmt(un.coluna, un.andar, un.caixaMaster) };
    }
    // Já está guardado em outro endereço e o operador escolheu um diferente → confirma antes.
    if (jaEnderecado && mudou && !dto.confirmar) {
      return {
        precisaConfirmar: true,
        codigo, descricao: un.descricao, tamanho: un.tamanho,
        atual: fmt(un.coluna, un.andar, un.caixaMaster),
        novo: fmt(dto.coluna, dto.andar, dto.caixaMaster),
      };
    }

    const upd = await this.prisma.unidadeEstoque.update({
      where: { codigo },
      data: { coluna: dto.coluna, andar: dto.andar, caixaMaster: dto.caixaMaster, status: 'em_estoque' },
    });
    return { codigo, descricao: upd.descricao, tamanho: upd.tamanho, endereco: fmt(dto.coluna, dto.andar, dto.caixaMaster), movido: jaEnderecado && mudou };
  }

  /** Lista as unidades em estoque (com filtros simples). */
  async listarUnidades(empresaId: number, status?: string, q?: string) {
    const termo = (q ?? '').trim();
    return this.prisma.unidadeEstoque.findMany({
      where: {
        empresaId,
        ...(status ? { status } : {}),
        ...(termo ? { OR: [
          { codigo: { contains: termo, mode: 'insensitive' } },
          { descricao: { contains: termo, mode: 'insensitive' } },
          { cor: { contains: termo, mode: 'insensitive' } },
          { tamanho: { equals: termo, mode: 'insensitive' } },
          { caixaMaster: { contains: termo, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: { id: 'desc' },
      take: 5000,
    });
  }

  /** Envia uma unidade para a QUARENTENA (anomalia / estorno de cliente). */
  async enviarQuarentena(codigoRaw: string, motivo: string, empresaId: number) {
    const codigo = (codigoRaw ?? '').trim();
    if (!codigo) throw new BadRequestException('Informe ou bipe a etiqueta.');
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo } });
    if (!un || un.empresaId !== empresaId) throw new NotFoundException(`Etiqueta ${codigo} não encontrada.`);
    if (un.status === 'despachado') throw new BadRequestException('Unidade já despachada não pode ir para quarentena.');
    const upd = await this.prisma.unidadeEstoque.update({
      where: { id: un.id },
      data: { status: 'quarentena', areaMotivo: (motivo ?? '').trim() || 'Sem motivo informado' },
    });
    return { codigo: upd.codigo, status: upd.status, areaMotivo: upd.areaMotivo };
  }

  /**
   * Resolve a quarentena: 'recebimento' devolve para alocação (limpa endereço);
   * 'estoque' mantém o endereço e volta a em_estoque (se já tinha endereço).
   */
  async resolverQuarentena(codigoRaw: string, destino: string, empresaId: number) {
    const codigo = (codigoRaw ?? '').trim();
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo } });
    if (!un || un.empresaId !== empresaId) throw new NotFoundException(`Etiqueta ${codigo} não encontrada.`);
    if (un.status !== 'quarentena') throw new BadRequestException('A unidade não está em quarentena.');
    const paraEstoque = destino === 'estoque' && (un.coluna != null || un.andar != null || un.caixaMaster != null);
    const upd = await this.prisma.unidadeEstoque.update({
      where: { id: un.id },
      data: paraEstoque
        ? { status: 'em_estoque', areaMotivo: null }
        : { status: 'aguardando_endereco', coluna: null, andar: null, caixaMaster: null, areaMotivo: null },
    });
    return { codigo: upd.codigo, status: upd.status };
  }

  /** Consulta uma unidade pela etiqueta (somente leitura) — status e endereço atual. */
  async consultarUnidade(codigoRaw: string, empresaId: number) {
    const codigo = (codigoRaw ?? '').trim();
    if (!codigo) throw new BadRequestException('Informe ou bipe a etiqueta.');
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo } });
    if (!un || un.empresaId !== empresaId) throw new NotFoundException(`Etiqueta ${codigo} não encontrada.`);
    const enderecado = un.coluna != null || un.andar != null || un.caixaMaster != null;
    const statusLabel: Record<string, string> = {
      aguardando_endereco: 'Recebimento (aguardando endereço)', em_estoque: 'Em estoque', reservado: 'Reservado (expedição)', despachado: 'Despachado', quarentena: 'Quarentena',
    };
    return {
      codigo: un.codigo,
      descricao: un.descricao,
      cor: un.cor,
      tamanho: un.tamanho,
      tipo: un.tipo,
      status: un.status,
      statusLabel: statusLabel[un.status] ?? un.status,
      enderecado,
      endereco: enderecado ? this.enderecoTxt({ coluna: un.coluna ?? undefined, andar: un.andar ?? undefined, caixaMaster: un.caixaMaster ?? undefined }) : null,
      coluna: un.coluna, andar: un.andar, caixaMaster: un.caixaMaster,
      loteEntrada: un.loteEntrada,
      loteFornecedor: un.loteFornecedor,
    };
  }

  /** Exclui uma etiqueta/unidade (somente admin — validado no controller). Bloqueia se já despachada. */
  async excluirUnidade(codigoRaw: string, empresaId: number): Promise<{ removido: true; codigo: string }> {
    const codigo = (codigoRaw ?? '').trim();
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo } });
    if (!un || un.empresaId !== empresaId) throw new NotFoundException(`Etiqueta ${codigo} não encontrada.`);
    if (un.status === 'despachado') throw new BadRequestException('Etiqueta já despachada não pode ser excluída.');
    await this.prisma.unidadeEstoque.delete({ where: { codigo } });
    return { removido: true, codigo };
  }

  /** Regenera as etiquetas (código de barras) de unidades já existentes, para reimpressão. */
  async etiquetasUnidades(codigos: string[], empresaId: number) {
    const lista = (codigos ?? []).map((c) => (c ?? '').trim()).filter(Boolean).slice(0, 500);
    if (!lista.length) throw new BadRequestException('Informe ao menos um código de unidade.');
    const unidades = await this.prisma.unidadeEstoque.findMany({ where: { empresaId, codigo: { in: lista } } });
    if (!unidades.length) throw new NotFoundException('Nenhuma unidade encontrada para reimpressão.');
    // REF = código do produto/material (não é gravado na unidade; buscamos pelos ids).
    const prodIds = [...new Set(unidades.map((u) => u.produtoId).filter((x): x is number => x != null))];
    const matIds = [...new Set(unidades.map((u) => u.materialId).filter((x): x is number => x != null))];
    const [prods, mats] = await Promise.all([
      prodIds.length ? this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true } }) : Promise.resolve([]),
      matIds.length ? this.prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true, codigo: true } }) : Promise.resolve([]),
    ]);
    const refProd = new Map(prods.map((p) => [p.id, p.codigo]));
    const refMat = new Map(mats.map((m) => [m.id, m.codigo]));
    // Preserva a ordem pedida (por código) para o operador.
    const porCodigo = new Map(unidades.map((u) => [u.codigo, u]));
    const pecas = [];
    for (const codigo of lista) {
      const u = porCodigo.get(codigo);
      if (!u) continue;
      const ref = (u.produtoId != null ? refProd.get(u.produtoId) : undefined) ?? (u.materialId != null ? refMat.get(u.materialId) : undefined) ?? '';
      const bc = await bwipjs.toBuffer({ bcid: 'code128', text: u.codigo, scale: 2, height: 12, includetext: false, padding: 0 });
      pecas.push({ codigo: u.codigo, ref, descricao: u.descricao, cor: u.cor ?? '', tamanho: u.tamanho ?? '', loteFornecedor: u.loteFornecedor ?? '', barcode: 'data:image/png;base64,' + bc.toString('base64') });
    }
    return { total: pecas.length, pecas };
  }

  /** Reimprime as etiquetas de todas as unidades de um lote de entrada (ex.: OP-123). */
  async etiquetasPorLote(lote: string, empresaId: number) {
    const l = (lote ?? '').trim();
    if (!l) throw new BadRequestException('Informe o lote.');
    const uns = await this.prisma.unidadeEstoque.findMany({ where: { empresaId, loteEntrada: l }, select: { codigo: true }, orderBy: { id: 'asc' } });
    if (!uns.length) throw new NotFoundException(`Nenhuma etiqueta encontrada para o lote ${l}.`);
    return this.etiquetasUnidades(uns.map((u) => u.codigo), empresaId);
  }

  // ===================== CAIXAS MASTER (etiqueta + conteúdo) =====================
  /** Extrai só os dígitos do identificador da caixa (aceita "1.000", "CX-1000", URL "?caixa=1000"). */
  private digitosCaixa(raw: string): string {
    const s = String(raw ?? '');
    const m = /caixa=([0-9.]+)/i.exec(s);
    return (m ? m[1] : s).replace(/\D/g, '');
  }

  /** Formata os dígitos de volta para o padrão de exibição (1000 -> "1.000"). */
  private fmtCaixa(digitos: string): string {
    const n = Number(digitos || 0);
    return n ? n.toLocaleString('pt-BR') : digitos;
  }

  /** Conteúdo de uma caixa master: unidades guardadas nela (não despachadas). */
  async conteudoCaixa(codigoRaw: string, empresaId: number) {
    const dig = this.digitosCaixa(codigoRaw);
    if (!dig) throw new BadRequestException('Informe o número/QR da caixa master.');
    const unidades = await this.prisma.unidadeEstoque.findMany({
      where: { empresaId, status: { not: 'despachado' }, caixaMaster: { not: null } },
      orderBy: [{ descricao: 'asc' }, { tamanho: 'asc' }],
      take: 1000,
    });
    const dentro = unidades.filter((u) => (u.caixaMaster ?? '').replace(/\D/g, '') === dig);
    // Agrupa por item (descrição+cor+tamanho) para leitura rápida do que tem dentro.
    const grupos = new Map<string, { descricao: string; cor: string; tamanho: string; quantidade: number; coluna?: string | null; andar?: string | null }>();
    for (const u of dentro) {
      const chave = `${u.descricao}|${u.cor ?? ''}|${u.tamanho ?? ''}`;
      const g = grupos.get(chave) ?? { descricao: u.descricao, cor: u.cor ?? '', tamanho: u.tamanho ?? '', quantidade: 0, coluna: u.coluna, andar: u.andar };
      g.quantidade += 1;
      grupos.set(chave, g);
    }
    const primeira = dentro[0];
    return {
      caixa: this.fmtCaixa(dig),
      digitos: dig,
      endereco: primeira ? `Coluna ${primeira.coluna ?? '—'} · Andar ${primeira.andar ?? '—'}` : null,
      totalPecas: dentro.length,
      itens: [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade),
      unidades: dentro.map((u) => ({ codigo: u.codigo, descricao: u.descricao, cor: u.cor, tamanho: u.tamanho, status: u.status })),
    };
  }

  /** Gera as etiquetas das caixas master (número + QR + código de barras) p/ colar nas caixas. */
  async etiquetasCaixas(empresaId: number, numsCsv?: string, base?: string) {
    const padrao = ['1.000', '2.000', '3.000', '4.000', '5.000', '6.000', '7.000', '8.000', '9.000', '10.000'];
    const nums = (numsCsv ? numsCsv.split(',').map((s) => s.trim()).filter(Boolean) : padrao);
    const baseUrl = (base ?? '').replace(/\/+$/, '');
    const etiquetas = [];
    for (const numero of nums) {
      const dig = this.digitosCaixa(numero);
      if (!dig) continue;
      const codigo = `CX-${dig}`;
      const urlQR = baseUrl ? `${baseUrl}/?caixa=${dig}` : codigo;
      const [qr, barcode] = await Promise.all([
        bwipjs.toBuffer({ bcid: 'qrcode', text: urlQR, scale: 4, padding: 0 }),
        bwipjs.toBuffer({ bcid: 'code128', text: codigo, scale: 2, height: 12, includetext: false, padding: 0 }),
      ]);
      etiquetas.push({
        numero: this.fmtCaixa(dig), digitos: dig, codigo,
        qr: 'data:image/png;base64,' + qr.toString('base64'),
        barcode: 'data:image/png;base64,' + barcode.toString('base64'),
      });
    }
    return { total: etiquetas.length, etiquetas };
  }

  /** Baixa uma unidade do estoque (bipada na saída/expedição). Idempotente. */
  async baixarUnidade(codigo: string, empresaId: number, expedicaoId?: number) {
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo: (codigo ?? '').trim() } });
    if (!un || un.empresaId !== empresaId) return null; // não é unidade de estoque
    if (un.status === 'despachado') return { ja: true, unidade: un };
    const upd = await this.prisma.unidadeEstoque.update({ where: { id: un.id }, data: { status: 'despachado', expedicaoId, saidaEm: new Date() } });
    return { ja: false, unidade: upd };
  }

  /** Posição de estoque (por produto/tamanho) com saldo = entradas - saídas. */
  async findAll(empresaId: number) {
    const posicoes = await this.prisma.estoque.findMany({
      where: { produto: { empresaId } },
      include: { produto: { select: { codigo: true, descricao: true } } },
      orderBy: [{ produtoId: 'asc' }, { tamanho: 'asc' }],
    });
    return posicoes.map((e) => ({
      ...e,
      saldo: e.entradas - e.saidas,
      abaixoMinimo: e.entradas - e.saidas < e.minimo,
    }));
  }

  /** Lotes de um produto pelo código (rastreabilidade). */
  async lotesPorCodigo(codigo: string, empresaId: number) {
    const produto = await this.prisma.produto.findUnique({ where: { codigo } });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${codigo} não encontrado.`);
    }
    return this.prisma.lote.findMany({
      where: { estoque: { produtoId: produto.id } },
      include: { estoque: { select: { tamanho: true } } },
      orderBy: { id: 'desc' },
    });
  }

  /** Movimenta o estoque: ENTRADA gera Lote rastreável; SAÍDA baixa o disponível. */
  async movimentar(dto: MovimentarEstoqueDto, empresaId: number) {
    const produto = await this.prisma.produto.findUnique({ where: { id: dto.produtoId } });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${dto.produtoId} não encontrado.`);
    }

    if (dto.tipo === 'entrada') {
      return this.prisma.$transaction(async (tx) => {
        const estoque = await tx.estoque.upsert({
          where: { produtoId_tamanho: { produtoId: dto.produtoId, tamanho: dto.tamanho } },
          update: {
            entradas: { increment: dto.quantidade },
            localizacao: dto.localizacao ?? undefined,
          },
          create: {
            produtoId: dto.produtoId,
            tamanho: dto.tamanho,
            entradas: dto.quantidade,
            saidas: 0,
            minimo: dto.minimo ?? 0,
            localizacao: dto.localizacao,
          },
        });
        const codigoLote = dto.codigoLote ?? (await this.gerarCodigoLote(tx));
        const lote = await tx.lote.create({
          data: {
            estoqueId: estoque.id,
            codigoLote,
            quantidade: dto.quantidade,
            opId: dto.opId,
          },
        });
        return {
          movimento: 'entrada',
          estoque: { ...estoque, saldo: estoque.entradas - estoque.saidas },
          lote,
        };
      });
    }

    // SAÍDA
    const estoque = await this.prisma.estoque.findUnique({
      where: { produtoId_tamanho: { produtoId: dto.produtoId, tamanho: dto.tamanho } },
    });
    const disponivel = estoque ? estoque.entradas - estoque.saidas : 0;
    if (!estoque || disponivel < dto.quantidade) {
      throw new BadRequestException(
        `Saldo insuficiente para saída (disponível: ${disponivel}, pedido: ${dto.quantidade}).`,
      );
    }
    const atualizado = await this.prisma.estoque.update({
      where: { id: estoque.id },
      data: { saidas: { increment: dto.quantidade } },
    });
    return {
      movimento: 'saida',
      estoque: { ...atualizado, saldo: atualizado.entradas - atualizado.saidas },
    };
  }

  /** Código de lote no padrão LAAMM-NN (ano/mês + sequencial do mês). */
  private async gerarCodigoLote(tx: Prisma.TransactionClient): Promise<string> {
    const agora = new Date();
    const yy = String(agora.getFullYear()).slice(2);
    const mm = String(agora.getMonth() + 1).padStart(2, '0');
    const prefixo = `L${yy}${mm}-`;
    const doMes = await tx.lote.findMany({
      where: { codigoLote: { startsWith: prefixo } },
      select: { codigoLote: true },
    });
    return proximoSequencial(prefixo, doMes.map((l) => l.codigoLote), { pad: 2, separador: '' });
  }
}
