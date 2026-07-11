import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  /** Define a grade de tamanhos da OP, ex.: {"P":10,"M":20,"G":8}. {} limpa. */
  async updateGrade(id: number, grade: Record<string, unknown>, empresaId: number): Promise<OP> {
    const op = await this.findOne(id, empresaId);
    const limpa: Record<string, number> = {};
    let total = 0;
    for (const [tamanho, qtd] of Object.entries(grade ?? {})) {
      const t = String(tamanho).trim().toUpperCase();
      const n = Number(qtd);
      if (!t || t.length > 6) throw new BadRequestException(`Tamanho inválido: "${tamanho}".`);
      if (!Number.isInteger(n) || n < 0) {
        throw new BadRequestException(`Quantidade inválida para ${t}: "${qtd}".`);
      }
      if (n > 0) { limpa[t] = n; total += n; }
    }
    if (total > 0 && total !== op.quantidade) {
      throw new BadRequestException(
        `A grade soma ${total} peças, mas a OP tem ${op.quantidade}. Ajuste as quantidades.`,
      );
    }
    return this.prisma.oP.update({
      where: { id },
      data: { gradeTamanhos: total > 0 ? limpa : undefined },
    });
  }

  async updateProgresso(id: number, dto: UpdateOpProgressoDto, empresaId: number): Promise<OP> {
    await this.findOne(id, empresaId);
    return this.prisma.oP.update({
      where: { id },
      data: { progresso: dto.progresso },
    });
  }
}
