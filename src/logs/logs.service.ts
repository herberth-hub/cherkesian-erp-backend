import { Injectable, Logger } from '@nestjs/common';
import { Log, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LogsFiltro {
  usuario?: string;
  entidade?: string;
  limit?: number;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um evento na trilha de auditoria. Usado por ações que o AuditInterceptor não
   * pega (ele só audita escrita) ou que precisam de um detalhe legível — por exemplo o
   * download de nota fiscal no Portal do Cliente, que é GET. Nunca lança: auditoria não
   * pode derrubar a operação de negócio.
   */
  async registrar(dados: {
    usuario: string;
    acao: string;
    detalhe?: string;
    entidade?: string;
    entidadeId?: string | number | null;
    ip?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.log.create({
        data: {
          usuario: String(dados.usuario || 'desconhecido').slice(0, 150),
          acao: String(dados.acao).slice(0, 150),
          detalhe: dados.detalhe ? String(dados.detalhe).slice(0, 500) : null,
          entidade: dados.entidade ?? null,
          entidadeId: dados.entidadeId != null ? String(dados.entidadeId) : null,
          ip: dados.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`Falha ao registrar auditoria (${dados.acao}): ${(e as Error).message}`);
    }
  }

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
