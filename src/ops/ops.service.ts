import { Injectable, NotFoundException } from '@nestjs/common';
import { OP } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateOpProgressoDto, UpdateOpStatusDto } from './dto/update-op.dto';

@Injectable()
export class OpsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number) {
    return this.prisma.oP.findMany({
      where: { pedido: { empresaId } },
      include: { pedido: { select: { numero: true, clienteId: true } } },
      orderBy: [{ prioridade: 'asc' }, { id: 'desc' }],
    });
  }

  async findOne(id: number, empresaId: number): Promise<OP> {
    const op = await this.prisma.oP.findUnique({
      where: { id },
      include: { pedido: { select: { empresaId: true } }, lotes: true },
    });
    if (!op || op.pedido?.empresaId !== empresaId) {
      throw new NotFoundException(`OP ${id} não encontrada.`);
    }
    return op;
  }

  async updateStatus(id: number, dto: UpdateOpStatusDto, empresaId: number): Promise<OP> {
    await this.findOne(id, empresaId);
    const data: Record<string, unknown> = {
      status: dto.status,
      setorAtual: dto.setorAtual,
      responsavel: dto.responsavel,
    };
    // Ajustes automáticos de acordo com o status
    if (dto.status === 'em_producao' || dto.status === 'em_corte') {
      const op = await this.prisma.oP.findUnique({ where: { id }, select: { inicio: true } });
      if (op && !op.inicio) data.inicio = new Date();
    }
    if (dto.status === 'concluido') {
      data.progresso = 100;
    }
    return this.prisma.oP.update({ where: { id }, data });
  }

  async updateProgresso(id: number, dto: UpdateOpProgressoDto, empresaId: number): Promise<OP> {
    await this.findOne(id, empresaId);
    return this.prisma.oP.update({
      where: { id },
      data: { progresso: dto.progresso },
    });
  }
}
