import { Injectable } from '@nestjs/common';
import { Log, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LogsFiltro {
  usuario?: string;
  entidade?: string;
  limit?: number;
}

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trilha de auditoria (imutável), mais recentes primeiro. Somente admin. */
  findAll(filtro: LogsFiltro): Promise<Log[]> {
    const where: Prisma.LogWhereInput = {};
    if (filtro.usuario) where.usuario = filtro.usuario;
    if (filtro.entidade) where.entidade = filtro.entidade;
    const take = Math.min(Math.max(filtro.limit ?? 100, 1), 500);
    return this.prisma.log.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });
  }
}
