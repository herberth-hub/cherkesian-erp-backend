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

  /** KPIs consolidados para o painel inicial (SPEC §4).
   *  `acesso` controla a visibilidade de dados financeiros: curva ABC e comparativo
   *  de faturamento são exclusivos do admin (`total`); o bloco financeiro (a receber/
   *  a pagar/saldos) é visível a quem lida com dinheiro (admin/financeiro/contabilidade). */
  async kpis(empresaId: number, acesso?: string) {
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
      // Radar = pedidos ainda NÃO entregues (exclui os concluídos/entregues).
      where: { empresaId, etapa: { notIn: ['concluido'] }, prazoEntrega: { not: null, lte: limite } },
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

    // ===== Alerta de TECIDO/INSUMO insuficiente p/ os pedidos em aberto =====
    // Demanda residual (por produto) dos pedidos ainda não concluídos x quantas peças
    // o estoque de material rende (limitado pelo material mais escasso da receita).
    const itensAbertos = await this.prisma.pedidoItem.findMany({
      where: { pedido: { empresaId, etapa: { notIn: ['concluido', 'orcamento'] } }, produtoId: { not: null } },
      select: { produtoId: true, quantidade: true, quantidadeExpedida: true, pedido: { select: { numero: true } } },
    });
    const demandaProd = new Map<number, { demanda: number; pedidos: Set<string> }>();
    for (const it of itensAbertos) {
      const pid = it.produtoId as number;
      const resid = Math.max(0, it.quantidade - (it.quantidadeExpedida ?? 0));
      if (resid <= 0) continue;
      const cur = demandaProd.get(pid) ?? { demanda: 0, pedidos: new Set<string>() };
      cur.demanda += resid;
      if (it.pedido?.numero) cur.pedidos.add(it.pedido.numero);
      demandaProd.set(pid, cur);
    }
    const consumosDash = await this.prisma.consumo.findMany({ where: { produto: { empresaId } }, include: { material: { select: { saldo: true } } } });
    const rendeProd = new Map<number, number>();
    for (const c of consumosDash) {
      const q = Number(c.quantidade);
      if (q <= 0) continue;
      const r = Math.floor(Number(c.material.saldo) / q);
      const cur = rendeProd.get(c.produtoId);
      rendeProd.set(c.produtoId, cur == null ? r : Math.min(cur, r));
    }
    const prodsAlerta = demandaProd.size
      ? await this.prisma.produto.findMany({ where: { id: { in: [...demandaProd.keys()] } }, select: { id: true, codigo: true, descricao: true } })
      : [];
    const nomeAlerta = new Map(prodsAlerta.map((p) => [p.id, p]));
    const alertasTecido = [...demandaProd.entries()]
      .filter(([pid]) => rendeProd.has(pid))
      .map(([pid, d]) => {
        const rende = rendeProd.get(pid) ?? 0;
        const p = nomeAlerta.get(pid);
        return { produtoId: pid, codigo: p?.codigo ?? '', descricao: p?.descricao ?? '', demanda: d.demanda, rende, falta: Math.max(0, d.demanda - rende), pedidos: [...d.pedidos] };
      })
      .filter((a) => a.falta > 0)
      .sort((a, b) => b.falta - a.falta);

    // ===== Remessas de facção (industrialização) aguardando RETORNO =====
    const remessasFacc = await this.prisma.notaFiscal.findMany({
      where: { empresaId, tipo: 'remessa', retornadaEm: null, status: { in: ['pendente', 'autorizada', 'simulada'] } },
      orderBy: { emitidaEm: 'asc' },
    });
    const fornIds = [...new Set(remessasFacc.map((r) => r.fornecedorId).filter((x): x is number => !!x))];
    const forns = fornIds.length ? await this.prisma.fornecedor.findMany({ where: { id: { in: fornIds } }, select: { id: true, nome: true } }) : [];
    const fornMap = new Map(forns.map((f) => [f.id, f.nome]));
    const remessasPendentes = remessasFacc.map((r) => {
      const dias = Math.floor((hojeMid.getTime() - new Date(r.emitidaEm).setHours(0, 0, 0, 0)) / 86400000);
      return { numero: r.numero, controle: r.controleFaccao, faccao: r.fornecedorId ? fornMap.get(r.fornecedorId) ?? null : null, valor: Number(r.valor), emitida: new Date(r.emitidaEm).toISOString().slice(0, 10), dias };
    });

    // ===== Visibilidade financeira por perfil =====
    const admin = acesso === 'total';
    const verFinanceiro = admin || acesso === 'financeiro' || acesso === 'contabilidade';

    // ===== Cobrar / Pagar HOJE: títulos VENCIDOS + que VENCEM HOJE (ação imediata) =====
    // Só para perfis financeiros. Diz "a quem cobrar" (a receber) e "a quem pagar" (a pagar).
    let cobrancasDia: unknown = undefined;
    if (verFinanceiro) {
      const [recAbertas, pagAbertas, clientesFin, fornecedoresFin] = await Promise.all([
        this.prisma.contaReceber.findMany({ where: { empresaId, status: { not: 'pago' } }, select: { id: true, clienteId: true, documento: true, valor: true, pago: true, vencimento: true } }),
        this.prisma.contaPagar.findMany({ where: { empresaId, status: { not: 'pago' } }, select: { id: true, fornecedorId: true, categoria: true, referencia: true, valor: true, pago: true, vencimento: true } }),
        this.prisma.cliente.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
        this.prisma.fornecedor.findMany({ select: { id: true, nome: true } }),
      ]);
      const nomeCli = new Map(clientesFin.map((c) => [c.id, c.nome]));
      const nomeForn = new Map(fornecedoresFin.map((f) => [f.id, f.nome]));
      const diasVenc = (v: Date) => Math.round((new Date(v).setHours(0, 0, 0, 0) - hojeMid.getTime()) / 86400000);
      // Mantém só vencidos (dias<0) e que vencem hoje (dias===0), com saldo em aberto; mais atrasado primeiro.
      const montar = <T extends { valor: unknown; pago: unknown; vencimento: Date; id: number }>(
        arr: T[], parteDe: (t: T) => string, refDe: (t: T) => string | null,
      ) => arr
        .map((t) => ({ t, saldo: Number(Number(t.valor) - Number(t.pago)), dias: diasVenc(t.vencimento) }))
        .filter((x) => x.saldo > 0.005 && x.dias <= 0)
        .sort((a, b) => a.dias - b.dias)
        .map((x) => ({
          id: x.t.id, parte: parteDe(x.t), ref: refDe(x.t),
          valor: Number(x.saldo.toFixed(2)),
          vencimento: new Date(x.t.vencimento).toISOString().slice(0, 10),
          dias: x.dias, status: x.dias < 0 ? 'vencida' : 'hoje',
        }));
      const receberLista = montar(recAbertas, (t) => nomeCli.get(t.clienteId) ?? 'Cliente', (t) => t.documento ?? null);
      const pagarLista = montar(pagAbertas, (t) => (t.fornecedorId != null ? nomeForn.get(t.fornecedorId) : null) ?? t.categoria ?? 'Fornecedor', (t) => t.referencia ?? t.categoria ?? null);
      const resumo = (lst: Array<{ valor: number; status: string }>) => ({
        qtd: lst.length,
        total: Number(lst.reduce((s, x) => s + x.valor, 0).toFixed(2)),
        vencido: Number(lst.filter((x) => x.status === 'vencida').reduce((s, x) => s + x.valor, 0).toFixed(2)),
        hoje: Number(lst.filter((x) => x.status === 'hoje').reduce((s, x) => s + x.valor, 0).toFixed(2)),
        qtdVencido: lst.filter((x) => x.status === 'vencida').length,
        qtdHoje: lst.filter((x) => x.status === 'hoje').length,
      });
      cobrancasDia = {
        receber: { ...resumo(receberLista), itens: receberLista.slice(0, 30) },
        pagar: { ...resumo(pagarLista), itens: pagarLista.slice(0, 30) },
      };

      // Lista COMPLETA em aberto (todos os títulos não pagos, qualquer vencimento),
      // por parte, ordenada do maior saldo p/ o menor — "quem está em aberto".
      const montarTodos = <T extends { valor: unknown; pago: unknown; vencimento: Date; id: number }>(
        arr: T[], parteDe: (t: T) => string, refDe: (t: T) => string | null,
      ) => arr
        .map((t) => ({ t, saldo: Number(Number(t.valor) - Number(t.pago)), dias: diasVenc(t.vencimento) }))
        .filter((x) => x.saldo > 0.005)
        .sort((a, b) => b.saldo - a.saldo)
        .map((x) => ({
          id: x.t.id, parte: parteDe(x.t), ref: refDe(x.t),
          valor: Number(x.saldo.toFixed(2)),
          vencimento: new Date(x.t.vencimento).toISOString().slice(0, 10),
          dias: x.dias, status: x.dias < 0 ? 'vencida' : x.dias === 0 ? 'hoje' : 'a_vencer',
        }));
      const recTodos = montarTodos(recAbertas, (t) => nomeCli.get(t.clienteId) ?? 'Cliente', (t) => t.documento ?? null);
      const pagTodos = montarTodos(pagAbertas, (t) => (t.fornecedorId != null ? nomeForn.get(t.fornecedorId) : null) ?? t.categoria ?? 'Fornecedor', (t) => t.referencia ?? t.categoria ?? null);
      const somaLst = (lst: Array<{ valor: number }>) => Number(lst.reduce((s, x) => s + x.valor, 0).toFixed(2));
      cobrancasDia = {
        ...(cobrancasDia as Record<string, unknown>),
        abertoReceber: { qtd: recTodos.length, total: somaLst(recTodos), itens: recTodos.slice(0, 60) },
        abertoPagar: { qtd: pagTodos.length, total: somaLst(pagTodos), itens: pagTodos.slice(0, 60) },
      };
    }

    const resposta: Record<string, unknown> = {
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
      alertasTecido,
      remessasPendentes,
      entregas: { janela: JANELA, faixas, lista: listaEntrega },
      // Sem visão financeira, o valor R$ dos pedidos é omitido (mantém o anti-atraso).
      pedidosEntrega: {
        janela: JANELA,
        faixas: faixasPed,
        lista: verFinanceiro ? listaPedidos : listaPedidos.map(({ valor: _v, ...resto }) => ({ ...resto, valor: null })),
      },
    };

    // Curva ABC (Pareto) e comparativo de faturamento por empresa: SOMENTE admin.
    if (admin) {
      resposta.porEmpresa = porEmpresa;
      resposta.curvaABC = { produtos: classificar(prodMap), clientes: classificar(cliMap) };
    }
    // Bloco financeiro consolidado: apenas perfis que lidam com dinheiro.
    if (verFinanceiro) {
      resposta.financeiro = {
        aReceber: fluxo.aberto.aReceber,
        aPagar: fluxo.aberto.aPagar,
        saldoRealizado: fluxo.realizado.saldo,
        saldoProjetado: fluxo.saldoProjetado,
      };
      resposta.cobrancasDia = cobrancasDia;
    }
    return resposta;
  }
}
