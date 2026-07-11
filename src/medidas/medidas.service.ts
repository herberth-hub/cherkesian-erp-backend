import { Injectable, NotFoundException } from '@nestjs/common';
import { Medida } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMedidaDto } from './dto/create-medida.dto';
import { UpdateMedidaDto } from './dto/update-medida.dto';

@Injectable()
export class MedidasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number, clienteId?: number): Promise<Medida[]> {
    return this.prisma.medida.findMany({
      where: { empresaId, ...(clienteId ? { clienteId } : {}) },
      include: { cliente: { select: { id: true, nome: true } } },
      orderBy: [{ clienteId: 'asc' }, { colaborador: 'asc' }],
    });
  }

  async findOne(id: number, empresaId: number): Promise<Medida> {
    const medida = await this.prisma.medida.findUnique({ where: { id } });
    if (!medida || medida.empresaId !== empresaId) {
      throw new NotFoundException(`Ficha de medida ${id} não encontrada.`);
    }
    return medida;
  }

  async create(dto: CreateMedidaDto, empresaId: number): Promise<Medida> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }
    return this.prisma.medida.create({ data: { empresaId, ...dto } });
  }

  async update(id: number, dto: UpdateMedidaDto, empresaId: number): Promise<Medida> {
    await this.findOne(id, empresaId);
    return this.prisma.medida.update({ where: { id }, data: dto });
  }

  async remove(id: number, empresaId: number): Promise<{ removido: number }> {
    await this.findOne(id, empresaId);
    await this.prisma.medida.delete({ where: { id } });
    return { removido: id };
  }
}
