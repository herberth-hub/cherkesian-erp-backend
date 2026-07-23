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

    // Mesmo radar, no nível do PEDIDO (prazo combinado com o cliente).
    // Mostra pedidos ainda não expedidos com prazo em até 15 dias (inclui atrasados).
    const pedidosPrazo = await this.prisma.pedido.findMany({
      where: { empresaId, etapa: { not: 'expedicao' }, prazoEntrega: { not: null, lte: limite } },
      select: { numero: true, valorTotal: true, etapa: true, prazoEntrega: true, cliente: { select: { nome: true } } },
      orderBy: { prazoEntrega: 'asc' },
    });
    const listaPedidos = pedidosPrazo.map((p) => {
      const dias = Math.round((new Date(p.prazoEntrega as Date).setHours(0, 0, 0, 0) - hojeMid.getTime()) / 86400000);
      return { numero: p.numero, cliente: p.cliente?.nome ?? null, valor: Number(p.valorTotal), etapa: p.etapa, prazo: (p.prazoEntrega as Date).toISOString().slice(0, 10), dias };
    });
    const faixasPed = { atrasadas: 0, ate5: 0, ate10: 0, ate15: 0 };
    for (const p of listaPedidos) {
      if (p.dias < 0) faixasPed.atrasadas++;
      else if (p.dias <= 5) faixasPed.ate5++;
      else if (p.dias <= 10) faixasPed.ate10++;
      else faixasPed.ate15++;
    }

    // ===== Comparativo por empresa/CNPJ (matriz e filiais) — fechamento do mês =====
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const [filiaisLista, pedidosFil, notasFil] = await Promise.all([
      this.prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true, cnpj: true, matriz: true } }),
      this.prisma.pedido.findMany({ where: { empresaId }, select: { filialId: true, valorTotal: true, data: true } }),
      this.prisma.notaFiscal.findMany({ where: { empresaId, status: { in: ['autorizada', 'simulada', 'pendente'] } }, select: { filialId: true, valor: true, emitidaEm: true } }),
    ]);
    const soma = (arr: { valorTotal?: unknown; valor?: unknown }[], campo: 'valorTotal' | 'valor') =>
      Number(arr.reduce((s, x) => s + Number(x[campo] ?? 0), 0).toFixed(2));
    const porEmpresa = filiaisLista.map((f) => {
      const peds = pedidosFil.filter((p) => p.filialId === f.id);
      const pedsMes = peds.filter((p) => p.data >= inicioMes);
      const nts = notasFil.filter((n) => n.filialId === f.id);
      const ntsMes = nts.filter((n) => n.emitidaEm >= inicioMes);
      return {
        id: f.id, nome: f.nome, cnpj: f.cnpj, matriz: f.matriz,
        pedidos: peds.length,
        valorPedidos: soma(peds, 'valorTotal'),
        pedidosMes: pedsMes.length,
        valorPedidosMes: soma(pedsMes, 'valorTotal'),
        notas: nts.length,
        faturamentoNfe: soma(nts, 'valor'),
        faturamentoNfeMes: soma(ntsMes, 'valor'),
      };
    }).sort((a, b) => b.faturamentoNfe - a.faturamentoNfe || b.valorPedidos - a.valorPedidos);

    // ===== Curva ABC (Pareto) por produto e por cliente (faturamento em pedidos) =====
    const pedidosAbc = await this.prisma.pedido.findMany({
      where: { empresaId },
      select: {
        valorTotal: true,
        cliente: { select: { nome: true } },
        itens: { select: { produtoId: true, descricao: true, quantidade: true, valorUnit: true } },
      },
    });
    const prodMap = new Map<string, { nome: string; valor: number }>();
    const cliMap = new Map<string, { nome: string; valor: number }>();
    for (const p of pedidosAbc) {
      const cn = p.cliente?.nome ?? '—';
      const c = cliMap.get(cn) ?? { nome: cn, valor: 0 };
      c.valor += Number(p.valorTotal); cliMap.set(cn, c);
      for (const it of p.itens) {
        const nome = it.descricao ?? ('Produto ' + (it.produtoId ?? '?'));
        const chave = it.produtoId ? 'P' + it.produtoId : 'D:' + nome;
        const x = prodMap.get(chave) ?? { nome, valor: 0 };
        x.valor += Number(it.valorUnit) * it.quantidade; prodMap.set(chave, x);
      }
    }
    const classificar = (m: Map<string, { nome: string; valor: number }>) => {
      const arr = [...m.values()].filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
      const total = arr.reduce((s, x) => s + x.valor, 0);
      let acc = 0;
      return arr.slice(0, 15).map((x) => {
        acc += x.valor;
        const cum = total ? (acc / total) * 100 : 0;
        const classe = cum <= 80 ? 'A' : cum <= 95 ? 'B' : 'C';
        return { nome: x.nome, valor: Number(x.valor.toFixed(2)), pct: Number((total ? (x.valor / total) * 100 : 0).toFixed(1)), classe };
      });
    };

    return {
      pedidos: {
        total: pedidos.length,
        porEtapa: contar(pedidos, 'etapa'),
      },
      porEmpresa,
      curvaABC: { produtos: classificar(prodMap), clientes: classificar(cliMap) },
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
      pedidosEntrega: { janela: JANELA, faixas: faixasPed, lista: listaPedidos },
    };
  }
}
