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
    };
  }
}
