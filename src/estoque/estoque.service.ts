import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MovimentarEstoqueDto } from './dto/movimentar.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class EstoqueService {
  constructor(private readonly prisma: PrismaService) {}

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
