import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrdemCompra } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrdemCompraDto } from './dto/create-ordem-compra.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<OrdemCompra[]> {
    return this.prisma.ordemCompra.findMany({
      where: { fornecedor: { empresaId } },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.prisma.ordemCompra.findUnique({
      where: { id },
      include: { fornecedor: { select: { empresaId: true, nome: true } } },
    });
    if (!oc || oc.fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Ordem de compra ${id} não encontrada.`);
    }
    return oc;
  }

  async create(dto: CreateOrdemCompraDto, empresaId: number): Promise<OrdemCompra> {
    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
    if (!fornecedor || fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Fornecedor ${dto.fornecedorId} não encontrado.`);
    }
    if (dto.materialId) {
      const material = await this.prisma.material.findUnique({ where: { id: dto.materialId } });
      if (!material || material.empresaId !== empresaId) {
        throw new NotFoundException(`Material ${dto.materialId} não encontrado.`);
      }
    }

    const numero = await this.gerarNumero();
    return this.prisma.ordemCompra.create({
      data: {
        numero,
        fornecedorId: dto.fornecedorId,
        materialId: dto.materialId,
        descricao: dto.descricao,
        quantidade: dto.quantidade,
        unidade: dto.unidade,
        valor: dto.valor,
        status: 'aguardando',
        previsao: dto.previsao ? new Date(dto.previsao) : undefined,
        motivo: dto.motivo,
      },
    });
  }

  /** Recebe a OC: baixa (status recebida) e repõe o saldo do material vinculado. */
  async receber(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.findOne(id, empresaId);
    if (oc.status !== 'aguardando') {
      throw new ConflictException(`OC ${oc.numero} não está aguardando (status: ${oc.status}).`);
    }

    const [atualizada] = await this.prisma.$transaction([
      this.prisma.ordemCompra.update({ where: { id }, data: { status: 'recebida' } }),
      ...(oc.materialId
        ? [
            this.prisma.material.update({
              where: { id: oc.materialId },
              data: { saldo: { increment: oc.quantidade } },
            }),
          ]
        : []),
    ]);
    return atualizada;
  }

  async cancelar(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.findOne(id, empresaId);
    if (oc.status !== 'aguardando') {
      throw new ConflictException(`OC ${oc.numero} não pode ser cancelada (status: ${oc.status}).`);
    }
    return this.prisma.ordemCompra.update({ where: { id }, data: { status: 'cancelada' } });
  }

  private async gerarNumero(): Promise<string> {
    const existentes = await this.prisma.ordemCompra.findMany({ select: { numero: true } });
    return proximoSequencial('OC', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }
}
