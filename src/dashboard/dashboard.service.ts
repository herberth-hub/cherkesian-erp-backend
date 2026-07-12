import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceiroService } from '../financeiro/financeiro.service';

/** Conta ocorrências de uma chave num array (ex.: etapas de pedido). */
function contar<T extends string>(itens: { [k: string]: unknown }[], campo: string): Record<T, number> {
  const acc = {} as Record<T, number>;
  for (const item of itens) {
    const chave = item[campo] as T;
    acc[chave] = (acc[chave] ?? 0) + 1;
  }
  return acc;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeiro: FinanceiroService,
  ) {}

  /** KPIs consolidados para o painel inicial (SPEC §4). */
  async kpis(empresaId: number) {
    const [pedidos, ops, ocsAguardando, materiais, clientes, produtos, fluxo] = await Promise.all([
      this.prisma.pedido.findMany({ where: { empresaId }, select: { etapa: true, valorTotal: true } }),
      this.prisma.oP.findMany({ where: { pedido: { empresaId } }, select: { status: true, quantidade: true } }),
      this.prisma.ordemCompra.count({ where: { fornecedor: { empresaId }, status: 'aguardando' } }),
      this.prisma.material.findMany({ where: { empresaId }, select: { saldo: true, minimo: true } }),
      this.prisma.cliente.count({ where: { empresaId } }),
      this.prisma.produto.count({ where: { empresaId } }),
      this.financeiro.fluxo(empresaId),
    ]);

    const opsAtivas = ops.filter((o) => o.status !== 'concluido');
    const pecasEmProducao = opsAtivas.reduce((s, o) => s + o.quantidade, 0);
    const materiaisAbaixoMinimo = materiais.filter((m) => m.saldo.lessThan(m.minimo)).length;

    // ===== Radar de entregas: OPs não concluídas com entrega em até 15 dias
    // (inclui atrasadas). Foco anti-atraso — dobrar atenção nos prazos. =====
    const JANELA = 15;
    const hojeMid = new Date();
    hojeMid.setHours(0, 0, 0, 0);
    const limite = new Date(hojeMid);
    limite.setDate(limite.getDate() + JANELA);
    limite.setHours(23, 59, 59, 999);
    const opsEntrega = await this.prisma.oP.findMany({
      where: { pedido: { empresaId }, status: { not: 'concluido' }, entregaPrev: { not: null, lte: limite } },
      select: { numero: true, quantidade: true, status: true, progresso: true, entregaPrev: true, pedido: { select: { numero: true, cliente: { select: { nome: true } } } } },
      orderBy: { entregaPrev: 'asc' },
    });
    const listaEntrega = opsEntrega.map((o) => {
      const dias = Math.round((new Date(o.entregaPrev as Date).setHours(0, 0, 0, 0) - hojeMid.getTime()) / 86400000);
      return {
        numero: o.numero,
        pedido: o.pedido?.numero ?? null,
        cliente: o.pedido?.cliente?.nome ?? null,
        quantidade: o.quantidade,
        status: o.status,
        progresso: o.progresso,
        entrega: (o.entregaPrev as Date).toISOString().slice(0, 10),
        dias,
      };
    });
    const faixas = { atrasadas: 0, ate5: 0, ate10: 0, ate15: 0 };
    for (const o of listaEntrega) {
      if (o.dias < 0) faixas.atrasadas++;
      else if (o.dias <= 5) faixas.ate5++;
      else if (o.dias <= 10) faixas.ate10++;
      else faixas.ate15++;
    }

    return {
      pedidos: {
        total: pedidos.length,
        porEtapa: contar(pedidos, 'etapa'),
      },
      producao: {
        opsAtivas: opsAtivas.length,
        pecasEmProducao,
        porStatus: contar(ops, 'status'),
      },
      compras: { ordensAguardando: ocsAguardando },
      estoque: {
        materiaisCadastrados: materiais.length,
        materiaisAbaixoMinimo,
      },
      cadastros: { clientes, produtos },
      financeiro: {
        aReceber: fluxo.aberto.aReceber,
        aPagar: fluxo.aberto.aPagar,
        saldoRealizado: fluxo.realizado.saldo,
        saldoProjetado: fluxo.saldoProjetado,
      },
      entregas: { janela: JANELA, faixas, lista: listaEntrega },
    };
  }
}
