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
    tipo: string; produtoId?: number; materialId?: number; descricao?: string; cor?: string; tamanho?: string;
    quantidade: number; destino?: 'estoque' | 'expedicao'; coluna?: string; andar?: number; caixaMaster?: string;
    pedidoId?: number; origem?: string;
  }, empresaId: number, usuario: string) {
    const qtd = Math.floor(Number(dto.quantidade));
    if (!qtd || qtd < 1) throw new BadRequestException('Informe a quantidade (>= 1).');
    if (qtd > 500) throw new BadRequestException('Máximo de 500 unidades por entrada.');

    // Descrição: do produto/material se houver, senão a informada.
    let descricao = dto.descricao;
    if (dto.produtoId) {
      const p = await this.prisma.produto.findUnique({ where: { id: dto.produtoId } });
      if (!p || p.empresaId !== empresaId) throw new NotFoundException(`Produto ${dto.produtoId} não encontrado.`);
      descricao = descricao ?? p.descricao;
    } else if (dto.materialId) {
      const m = await this.prisma.material.findUnique({ where: { id: dto.materialId } });
      if (!m || m.empresaId !== empresaId) throw new NotFoundException(`Material ${dto.materialId} não encontrado.`);
      descricao = descricao ?? m.descricao;
    }
    if (!descricao) throw new BadRequestException('Informe a descrição do item (ou selecione um produto/material).');

    const paraExpedicao = dto.destino === 'expedicao';
    const status = paraExpedicao ? 'reservado' : (dto.coluna && dto.andar != null && dto.caixaMaster ? 'em_estoque' : 'aguardando_endereco');
    const agora = new Date();
    const ymd = agora.toISOString().slice(0, 10).replace(/-/g, '');
    const base = await this.prisma.unidadeEstoque.count({ where: { codigo: { startsWith: `UN-${ymd}-` } } });
    const loteEntrada = `ENT-${ymd}-${String(base + 1).padStart(4, '0')}`;

    const criadas: Array<{ codigo: string }> = [];
    for (let i = 0; i < qtd; i++) {
      const codigo = `UN-${ymd}-${String(base + 1 + i).padStart(6, '0')}`;
      await this.prisma.unidadeEstoque.create({
        data: {
          empresaId, codigo, tipo: dto.tipo, produtoId: dto.produtoId, materialId: dto.materialId,
          descricao, cor: dto.cor, tamanho: dto.tamanho, origem: dto.origem ?? 'entrada',
          coluna: dto.coluna, andar: dto.andar, caixaMaster: dto.caixaMaster, status,
          pedidoId: paraExpedicao ? dto.pedidoId : undefined, loteEntrada, criadoPor: usuario,
        },
      });
      criadas.push({ codigo });
    }
    // Gera as etiquetas (código de barras) das unidades criadas.
    const pecas = [];
    for (const c of criadas) {
      const bc = await bwipjs.toBuffer({ bcid: 'code128', text: c.codigo, scale: 2, height: 12, includetext: false, padding: 0 });
      pecas.push({ codigo: c.codigo, descricao, cor: dto.cor ?? '', tamanho: dto.tamanho ?? '', barcode: 'data:image/png;base64,' + bc.toString('base64') });
    }
    return { loteEntrada, total: qtd, destino: dto.destino ?? 'estoque', status, endereco: this.enderecoTxt(dto), pecas };
  }

  private enderecoTxt(d: { coluna?: string; andar?: number; caixaMaster?: string }): string | null {
    if (!d.coluna && d.andar == null && !d.caixaMaster) return null;
    return `Coluna ${d.coluna ?? '—'} · Andar ${d.andar ?? '—'} · Caixa ${d.caixaMaster ?? '—'}`;
  }

  /** Endereça uma unidade (bipada) no armazém. */
  async enderecar(dto: { codigo: string; coluna: string; andar: number; caixaMaster: string }, empresaId: number, usuario: string) {
    const codigo = (dto.codigo ?? '').trim();
    const un = await this.prisma.unidadeEstoque.findUnique({ where: { codigo } });
    if (!un || un.empresaId !== empresaId) throw new NotFoundException(`Unidade ${codigo} não encontrada.`);
    if (un.status === 'despachado') throw new BadRequestException('Unidade já despachada.');
    const upd = await this.prisma.unidadeEstoque.update({
      where: { codigo },
      data: { coluna: dto.coluna, andar: dto.andar, caixaMaster: dto.caixaMaster, status: 'em_estoque' },
    });
    return { codigo, descricao: upd.descricao, tamanho: upd.tamanho, endereco: `Coluna ${dto.coluna} · Andar ${dto.andar} · Caixa ${dto.caixaMaster}` };
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
      take: 500,
    });
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
