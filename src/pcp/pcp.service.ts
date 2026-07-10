import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function diasEntre(de: Date, ate: Date): number {
  const a = Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate());
  const b = Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

@Injectable()
export class PcpService {
  constructor(private readonly prisma: PrismaService) {}

  /** Painel de produção: OPs em aberto com prazo, progresso, prioridade e atraso. */
  async painel(empresaId: number) {
    const hoje = new Date();
    const ops = await this.prisma.oP.findMany({
      where: { pedido: { empresaId }, status: { not: 'concluido' } },
      include: { pedido: { select: { numero: true, clienteId: true } } },
      orderBy: [{ prioridade: 'asc' }, { entregaPrev: 'asc' }, { id: 'asc' }],
    });

    return ops.map((op) => {
      const diasParaEntrega = op.entregaPrev ? diasEntre(hoje, op.entregaPrev) : null;
      const atrasada = diasParaEntrega != null && diasParaEntrega < 0 && op.progresso < 100;
      return {
        numero: op.numero,
        pedido: op.pedido?.numero ?? null,
        produtoId: op.produtoId,
        quantidade: op.quantidade,
        status: op.status,
        prioridade: op.prioridade,
        progresso: op.progresso,
        setorAtual: op.setorAtual,
        responsavel: op.responsavel,
        entregaPrev: op.entregaPrev,
        diasParaEntrega,
        atrasada,
      };
    });
  }

  /** Capacidade/carga: OPs ativas, peças em produção e distribuição por status/prioridade/setor. */
  async capacidade(empresaId: number) {
    const ops = await this.prisma.oP.findMany({
      where: { pedido: { empresaId }, status: { not: 'concluido' } },
      select: { status: true, prioridade: true, setorAtual: true, quantidade: true },
    });

    const porStatus: Record<string, number> = {};
    const porPrioridade: Record<string, number> = {};
    const porSetor: Record<string, number> = {};
    let pecasEmProducao = 0;

    for (const op of ops) {
      porStatus[op.status] = (porStatus[op.status] ?? 0) + 1;
      porPrioridade[op.prioridade] = (porPrioridade[op.prioridade] ?? 0) + 1;
      const setor = op.setorAtual ?? 'não definido';
      porSetor[setor] = (porSetor[setor] ?? 0) + 1;
      pecasEmProducao += op.quantidade;
    }

    return {
      opsAtivas: ops.length,
      pecasEmProducao,
      porStatus,
      porPrioridade,
      porSetor,
    };
  }
}
