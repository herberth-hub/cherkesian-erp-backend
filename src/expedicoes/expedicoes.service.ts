import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Expedicao, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpedicaoDto } from './dto/create-expedicao.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class ExpedicoesService {
  constructor(private readonly prisma: PrismaService) {}

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
