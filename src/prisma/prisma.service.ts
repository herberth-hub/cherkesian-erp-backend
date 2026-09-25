import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly diag = new Logger('Prisma');

  constructor() {
    // PRISMA_LOG=1 liga o log de consultas. É o jeito de achar N+1: aparece o
    // endpoint disparando dezenas de queries iguais para montar uma lista.
    super(process.env.PRISMA_LOG === '1' ? { log: [{ emit: 'event', level: 'query' }] } : {});
  }

  async onModuleInit(): Promise<void> {
    if (process.env.PRISMA_LOG === '1') {
      this.$on('query', (e) => this.diag.debug(`${e.duration}ms ${e.query.slice(0, 120)}`));
    }
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
