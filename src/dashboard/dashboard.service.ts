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

  /**
   * Painel do Diretor: um índice (0–100) por pilar da empresa — Clientes, Pedidos,
   * Produção, Entrega e Faturamento — com as métricas que compõem cada índice.
   */
  async indices(empresaId: number) {
    const agora = new Date();
    const y = agora.getUTCFullYear(), mo = agora.getUTCMonth();
    const iniMes = new Date(Date.UTC(y, mo, 1));
    const iniMesAnt = new Date(Date.UTC(y, mo - 1, 1));
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
    const dias90 = new Date(Date.now() - 90 * 86400000);

    const [clientesTot, novosMes, pedidos, ops, nfsMes, nfsMesAnt, receber] = await Promise.all([
      this.prisma.cliente.count({ where: { empresaId } }),
      this.prisma.cliente.count({ where: { empresaId, criadoEm: { gte: iniMes } } }),
      this.prisma.pedido.findMany({ where: { empresaId }, select: { clienteId: true, etapa: true, valorTotal: true, data: true, prazoEntrega: true } }),
      this.prisma.oP.findMany({ where: { pedido: { empresaId } }, select: { status: true, entregaPrev: true } }),
      this.prisma.notaFiscal.findMany({ where: { empresaId, status: 'autorizada', emitidaEm: { gte: iniMes } }, select: { valor: true } }),
      this.prisma.notaFiscal.findMany({ where: { empresaId, status: 'autorizada', emitidaEm: { gte: iniMesAnt, lt: iniMes } }, select: { valor: true } }),
      this.prisma.contaReceber.findMany({ where: { empresaId }, select: { clienteId: true, valor: true, pago: true, vencimento: true } }),
    ]);

    const round = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    const statusDe = (i: number) => (i >= 80 ? 'bom' : i >= 60 ? 'atencao' : 'critico');

    // ===== CLIENTES: ativação da carteira =====
    const ativos90 = new Set(pedidos.filter((p) => p.data >= dias90).map((p) => p.clienteId)).size;
    const inadimplentes = new Set(
      receber.filter((r) => Number(r.valor) - Number(r.pago) > 0.005 && r.vencimento < hoje0).map((r) => r.clienteId),
    ).size;
    const idxClientes = round(clientesTot > 0 ? (ativos90 / clientesTot) * 100 : 0);

    // ===== PEDIDOS: conversão orçamento -> aprovado =====
    const orcamentos = pedidos.filter((p) => p.etapa === 'orcamento');
    const aprovados = pedidos.filter((p) => p.etapa !== 'orcamento' && p.etapa !== 'cancelado');
    const baseConv = aprovados.length + orcamentos.length;
    const conversao = baseConv > 0 ? (aprovados.length / baseConv) * 100 : 0;
    const pedidosMes = pedidos.filter((p) => p.data >= iniMes && p.etapa !== 'cancelado').length;
    const ticket = aprovados.length ? aprovados.reduce((s, p) => s + Number(p.valorTotal), 0) / aprovados.length : 0;
    const pipeline = orcamentos.reduce((s, p) => s + Number(p.valorTotal), 0);
    const idxPedidos = round(conversao);

    // ===== PRODUÇÃO: OPs no prazo =====
    const opsAtivas = ops.filter((o) => o.status !== 'concluido');
    const opsAtras = opsAtivas.filter((o) => o.entregaPrev && new Date(o.entregaPrev) < hoje0);
    const opsConcl = ops.filter((o) => o.status === 'concluido').length;
    const idxProducao = round(opsAtivas.length > 0 ? ((opsAtivas.length - opsAtras.length) / opsAtivas.length) * 100 : 100);

    // ===== ENTREGA: pedidos no prazo =====
    const emEntrega = pedidos.filter((p) => !['orcamento', 'cancelado', 'concluido'].includes(p.etapa));
    const atrasadosEnt = emEntrega.filter((p) => p.prazoEntrega && new Date(p.prazoEntrega) < hoje0);
    const entregues = pedidos.filter((p) => p.etapa === 'concluido').length;
    const idxEntrega = round(emEntrega.length > 0 ? ((emEntrega.length - atrasadosEnt.length) / emEntrega.length) * 100 : 100);

    // ===== FATURAMENTO: crescimento + saúde da cobrança =====
    const fatMes = nfsMes.reduce((s, n) => s + Number(n.valor), 0);
    const fatAnt = nfsMesAnt.reduce((s, n) => s + Number(n.valor), 0);
    const aReceber = receber.reduce((s, r) => s + Math.max(0, Number(r.valor) - Number(r.pago)), 0);
    const vencido = receber.filter((r) => r.vencimento < hoje0).reduce((s, r) => s + Math.max(0, Number(r.valor) - Number(r.pago)), 0);
    const cobrancaSaude = aReceber > 0 ? (1 - vencido / aReceber) * 100 : 100;
    const crescIdx = fatAnt > 0 ? Math.min(100, (fatMes / fatAnt) * 100) : fatMes > 0 ? 100 : 50;
    const idxFaturamento = round(0.5 * cobrancaSaude + 0.5 * crescIdx);
    const crescPct = fatAnt > 0 ? ((fatMes - fatAnt) / fatAnt) * 100 : null;

    const brl = (n: number) => n;
    const pilares = [
      {
        chave: 'clientes', nome: 'Clientes', icone: '👥', indice: idxClientes, status: statusDe(idxClientes),
        resumo: `${ativos90} de ${clientesTot} ativos (90 dias)`,
        metricas: [
          { label: 'Total de clientes', valor: clientesTot },
          { label: 'Novos no mês', valor: novosMes },
          { label: 'Ativos (compraram em 90 dias)', valor: ativos90 },
          { label: 'Inadimplentes', valor: inadimplentes, alerta: inadimplentes > 0 },
        ],
      },
      {
        chave: 'pedidos', nome: 'Pedidos', icone: '🛒', indice: idxPedidos, status: statusDe(idxPedidos),
        resumo: `${conversao.toFixed(0)}% de conversão de orçamentos`,
        metricas: [
          { label: 'Conversão (aprovado / total)', valor: `${conversao.toFixed(0)}%` },
          { label: 'Orçamentos em aberto', valor: orcamentos.length },
          { label: 'Pedidos no mês', valor: pedidosMes },
          { label: 'Ticket médio', valor: brl(ticket), moeda: true },
          { label: 'Pipeline (orçamentos)', valor: brl(pipeline), moeda: true },
        ],
      },
      {
        chave: 'producao', nome: 'Produção', icone: '🏭', indice: idxProducao, status: statusDe(idxProducao),
        resumo: `${opsAtras.length} OP(s) atrasada(s) de ${opsAtivas.length} ativas`,
        metricas: [
          { label: 'OPs ativas', valor: opsAtivas.length },
          { label: 'OPs concluídas', valor: opsConcl },
          { label: 'OPs atrasadas', valor: opsAtras.length, alerta: opsAtras.length > 0 },
        ],
      },
      {
        chave: 'entrega', nome: 'Entrega', icone: '🚚', indice: idxEntrega, status: statusDe(idxEntrega),
        resumo: `${atrasadosEnt.length} pedido(s) atrasado(s) na entrega`,
        metricas: [
          { label: 'A entregar (em aberto)', valor: emEntrega.length },
          { label: 'Atrasados', valor: atrasadosEnt.length, alerta: atrasadosEnt.length > 0 },
          { label: 'Entregues (concluídos)', valor: entregues },
        ],
      },
      {
        chave: 'faturamento', nome: 'Faturamento', icone: '💰', indice: idxFaturamento, status: statusDe(idxFaturamento),
        resumo: crescPct == null ? `${brl(fatMes)}` : `${crescPct >= 0 ? '+' : ''}${crescPct.toFixed(0)}% vs mês anterior`,
        metricas: [
          { label: 'Faturado no mês (NF-e)', valor: brl(fatMes), moeda: true },
          { label: 'Mês anterior', valor: brl(fatAnt), moeda: true },
          { label: 'A receber em aberto', valor: brl(aReceber), moeda: true },
          { label: 'Vencido (inadimplência)', valor: brl(vencido), moeda: true, alerta: vencido > 0 },
        ],
      },
    ];
    const geral = round(pilares.reduce((s, p) => s + p.indice, 0) / pilares.length);
    return { geral, statusGeral: statusDe(geral), pilares, atualizadoEm: agora.toISOString() };
  }

  /**
   * Mapa mental de CAUSA RAIZ de um pilar. Devolve uma árvore: do índice → grupos
   * de causa → registros concretos (pedido/OP/título/cliente). Cada folha traz
   * `rota` + `alvo` p/ o frontend "clicar até o registro" e agir rápido.
   */
  async drill(empresaId: number, pilar: string) {
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
    const diasAtraso = (d: Date | null | undefined) =>
      d ? Math.floor((hoje0.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000) : 0;

    if (pilar === 'entrega') return this.drillEntrega(empresaId, hoje0, diasAtraso);
    if (pilar === 'producao') return this.drillProducao(empresaId, hoje0, diasAtraso);
    if (pilar === 'clientes') return this.drillClientes(empresaId, hoje0);
    if (pilar === 'pedidos') return this.drillPedidos(empresaId);
    if (pilar === 'faturamento') return this.drillFaturamento(empresaId, hoje0, diasAtraso);
    return { raiz: { id: 'x', label: 'Pilar desconhecido', tipo: 'raiz', filhos: [] } };
  }

  /** ENTREGA: pedidos atrasados → agrupados pela ETAPA travada → pedido → OPs (raiz). */
  private async drillEntrega(
    empresaId: number, hoje0: Date,
    diasAtraso: (d: Date | null | undefined) => number,
  ) {
    const atrasados = await this.prisma.pedido.findMany({
      where: { empresaId, etapa: { notIn: ['orcamento', 'cancelado', 'concluido'] }, prazoEntrega: { not: null, lt: hoje0 } },
      select: {
        id: true, numero: true, valorTotal: true, prazoEntrega: true, etapa: true,
        cliente: { select: { nome: true } },
        ops: { select: { numero: true, status: true, progresso: true, setorAtual: true } },
      },
      orderBy: { prazoEntrega: 'asc' },
    });

    const GRUPOS: Record<string, { label: string; causa: string }> = {
      aprovado: { label: 'Aprovado, produção não iniciada', causa: 'PCP não abriu/priorizou a OP' },
      piloto: { label: 'Travado no piloto', causa: 'Amostra pendente de aprovação do cliente' },
      material: { label: 'Aguardando material', causa: 'Falta tecido/insumo — ver compras' },
      compra: { label: 'Aguardando compra', causa: 'Ordem de compra em aberto' },
      producao: { label: 'Preso na produção', causa: 'Corte/costura/facção em andamento ou parado' },
      estoque: { label: 'Pronto — aguardando expedição', causa: 'Produzido mas não faturado/despachado' },
      expedicao: { label: 'Na expedição, não despachado', causa: 'Falta emitir NF / romaneio / coleta' },
    };
    const ordem = ['producao', 'material', 'compra', 'piloto', 'aprovado', 'estoque', 'expedicao'];

    const porEtapa = new Map<string, typeof atrasados>();
    for (const p of atrasados) {
      const arr = porEtapa.get(p.etapa) || [];
      arr.push(p); porEtapa.set(p.etapa, arr);
    }

    const filhos = ordem.filter((e) => porEtapa.has(e)).map((etapa) => {
      const peds = porEtapa.get(etapa)!;
      const g = GRUPOS[etapa] || { label: etapa, causa: '' };
      return {
        id: 'g_' + etapa, tipo: 'grupo', label: g.label, valor: peds.length, status: 'critico',
        hint: g.causa,
        filhos: peds.map((p) => {
          const dias = diasAtraso(p.prazoEntrega);
          // Causa raiz do pedido em produção: as OPs e onde estão paradas.
          const opsFilhas = (p.ops || []).map((o) => ({
            id: 'op_' + o.numero, tipo: 'folha', label: 'OP ' + o.numero,
            hint: `${o.status}${o.setorAtual ? ' · ' + o.setorAtual : ''} · ${o.progresso || 0}%`,
            status: (o.progresso || 0) >= 80 ? 'atencao' : 'critico',
            rota: 'producao', alvo: o.numero,
          }));
          return {
            id: 'ped_' + p.id, tipo: opsFilhas.length ? 'grupo' : 'folha',
            label: p.numero + ' · ' + (p.cliente?.nome || 'Cliente'),
            hint: `${dias} dia(s) atrasado`, valor: Number(p.valorTotal), moeda: true, status: 'critico',
            rota: 'vendas', alvo: p.numero,
            filhos: opsFilhas.length ? opsFilhas : undefined,
          };
        }),
      };
    });

    return {
      raiz: {
        id: 'entrega', tipo: 'raiz', icone: '🚚', label: 'Entrega — pedidos atrasados',
        valor: atrasados.length, status: atrasados.length ? 'critico' : 'bom',
        hint: 'Clique numa causa → no pedido → na OP para achar onde travou',
        filhos,
      },
    };
  }

  /** PRODUÇÃO: OPs atrasadas → agrupadas por STATUS (gargalo) → OP (raiz). */
  private async drillProducao(
    empresaId: number, hoje0: Date,
    diasAtraso: (d: Date | null | undefined) => number,
  ) {
    const ops = await this.prisma.oP.findMany({
      where: { pedido: { empresaId }, status: { not: 'concluido' }, entregaPrev: { not: null, lt: hoje0 } },
      select: {
        numero: true, status: true, progresso: true, setorAtual: true, entregaPrev: true, quantidade: true,
        pedido: { select: { numero: true, cliente: { select: { nome: true } } } },
      },
      orderBy: { entregaPrev: 'asc' },
    });
    const LABEL: Record<string, string> = {
      aguardando_material: 'Aguardando material (gargalo de insumo)',
      a_iniciar: 'A iniciar (fila de corte)',
      em_corte: 'Em corte',
      em_producao: 'Em produção (costura)',
      em_faccao: 'Na facção (fora)',
    };
    const grupos = new Map<string, typeof ops>();
    for (const o of ops) { const a = grupos.get(o.status) || []; a.push(o); grupos.set(o.status, a); }
    const filhos = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length).map(([st, arr]) => ({
      id: 'st_' + st, tipo: 'grupo', label: LABEL[st] || st, valor: arr.length, status: 'critico',
      filhos: arr.map((o) => ({
        id: 'op_' + o.numero, tipo: 'folha',
        label: 'OP ' + o.numero + ' · ' + (o.pedido?.cliente?.nome || o.pedido?.numero || 'avulsa'),
        hint: `${diasAtraso(o.entregaPrev)}d atrasado · ${o.progresso || 0}% · ${o.quantidade} pç${o.setorAtual ? ' · ' + o.setorAtual : ''}`,
        status: (o.progresso || 0) >= 80 ? 'atencao' : 'critico',
        rota: 'producao', alvo: o.numero,
      })),
    }));
    return {
      raiz: {
        id: 'producao', tipo: 'raiz', icone: '🏭', label: 'Produção — OPs atrasadas',
        valor: ops.length, status: ops.length ? 'critico' : 'bom',
        hint: 'Agrupado pelo gargalo (status). Clique para ver as OPs paradas.',
        filhos,
      },
    };
  }

  /** CLIENTES: inativos (90d) + inadimplentes → cliente (raiz). */
  private async drillClientes(empresaId: number, hoje0: Date) {
    const dias90 = new Date(Date.now() - 90 * 86400000);
    const [clientes, pedidos, receber] = await Promise.all([
      this.prisma.cliente.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
      this.prisma.pedido.findMany({ where: { empresaId }, select: { clienteId: true, data: true } }),
      this.prisma.contaReceber.findMany({ where: { empresaId }, select: { clienteId: true, valor: true, pago: true, vencimento: true, documento: true } }),
    ]);
    const ultimaCompra = new Map<number, Date>();
    for (const p of pedidos) {
      const cur = ultimaCompra.get(p.clienteId);
      if (!cur || p.data > cur) ultimaCompra.set(p.clienteId, p.data);
    }
    const nome = new Map(clientes.map((c) => [c.id, c.nome]));
    const inativos = clientes.filter((c) => { const u = ultimaCompra.get(c.id); return !u || u < dias90; });
    // Inadimplentes: por cliente, soma do saldo vencido.
    const vencPorCli = new Map<number, number>();
    for (const r of receber) {
      const saldo = Number(r.valor) - Number(r.pago);
      if (saldo > 0.005 && r.vencimento < hoje0) vencPorCli.set(r.clienteId, (vencPorCli.get(r.clienteId) || 0) + saldo);
    }
    const filhos = [
      {
        id: 'inativos', tipo: 'grupo', label: 'Clientes inativos (90+ dias sem comprar)', valor: inativos.length, status: inativos.length ? 'atencao' : 'bom',
        hint: 'Alvos para reativação / follow-up do vendedor',
        filhos: inativos.slice(0, 60).map((c) => {
          const u = ultimaCompra.get(c.id);
          return { id: 'cli_' + c.id, tipo: 'folha', label: c.nome, hint: u ? `última compra em ${new Date(u).toISOString().slice(0, 10)}` : 'nunca comprou', status: 'atencao', rota: 'clientes', alvo: String(c.id), busca: c.nome };
        }),
      },
      {
        id: 'inadimplentes', tipo: 'grupo', label: 'Inadimplentes (título vencido)', valor: vencPorCli.size, status: vencPorCli.size ? 'critico' : 'bom',
        hint: 'Cobrança pendente — risco de crédito',
        filhos: [...vencPorCli.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([cid, v]) => ({
          id: 'clir_' + cid, tipo: 'folha', label: nome.get(cid) || ('Cliente #' + cid), hint: 'vencido em aberto', valor: Number(v.toFixed(2)), moeda: true, status: 'critico', rota: 'receber', alvo: String(cid), busca: nome.get(cid) || '',
        })),
      },
    ];
    return { raiz: { id: 'clientes', tipo: 'raiz', icone: '👥', label: 'Clientes — carteira', valor: clientes.length, status: 'atencao', hint: 'Onde a carteira está perdendo tração.', filhos } };
  }

  /** PEDIDOS: orçamentos em aberto (não convertidos), por idade → orçamento (raiz). */
  private async drillPedidos(empresaId: number) {
    const orcs = await this.prisma.pedido.findMany({
      where: { empresaId, etapa: 'orcamento' },
      select: { id: true, numero: true, valorTotal: true, data: true, cliente: { select: { nome: true } } },
      orderBy: { data: 'asc' },
    });
    const hoje = Date.now();
    const idade = (d: Date) => Math.floor((hoje - new Date(d).getTime()) / 86400000);
    const faixa = (dias: number) => (dias > 30 ? 'frios' : dias > 7 ? 'mornos' : 'novos');
    const LAB: Record<string, { label: string; status: string }> = {
      frios: { label: 'Frios (30+ dias parados)', status: 'critico' },
      mornos: { label: 'Mornos (8–30 dias)', status: 'atencao' },
      novos: { label: 'Novos (até 7 dias)', status: 'bom' },
    };
    const grupos = new Map<string, typeof orcs>();
    for (const o of orcs) { const f = faixa(idade(o.data)); const a = grupos.get(f) || []; a.push(o); grupos.set(f, a); }
    const filhos = ['frios', 'mornos', 'novos'].filter((f) => grupos.has(f)).map((f) => ({
      id: 'f_' + f, tipo: 'grupo', label: LAB[f].label, valor: grupos.get(f)!.length, status: LAB[f].status,
      filhos: grupos.get(f)!.map((o) => ({
        id: 'orc_' + o.id, tipo: 'folha', label: o.numero + ' · ' + (o.cliente?.nome || 'Cliente'),
        hint: `${idade(o.data)} dia(s) sem fechar`, valor: Number(o.valorTotal), moeda: true, status: LAB[f].status,
        rota: 'vendas', alvo: o.numero,
      })),
    }));
    return { raiz: { id: 'pedidos', tipo: 'raiz', icone: '🛒', label: 'Pedidos — orçamentos não convertidos', valor: orcs.length, status: 'atencao', hint: 'Priorize os frios: quanto mais parado, menor a chance de fechar.', filhos } };
  }

  /** FATURAMENTO: inadimplência (vencido) por cliente → título (raiz). */
  private async drillFaturamento(empresaId: number, hoje0: Date, diasAtraso: (d: Date | null | undefined) => number) {
    const [receber, clientes] = await Promise.all([
      this.prisma.contaReceber.findMany({ where: { empresaId, status: { not: 'pago' } }, select: { id: true, clienteId: true, documento: true, valor: true, pago: true, vencimento: true } }),
      this.prisma.cliente.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
    ]);
    const nome = new Map(clientes.map((c) => [c.id, c.nome]));
    const vencidos = receber.map((r) => ({ ...r, saldo: Number(r.valor) - Number(r.pago), dias: diasAtraso(r.vencimento) }))
      .filter((r) => r.saldo > 0.005 && r.dias > 0);
    const porCli = new Map<number, typeof vencidos>();
    for (const r of vencidos) { const a = porCli.get(r.clienteId) || []; a.push(r); porCli.set(r.clienteId, a); }
    const filhos = [...porCli.entries()]
      .map(([cid, arr]) => ({ cid, arr, total: arr.reduce((s, x) => s + x.saldo, 0) }))
      .sort((a, b) => b.total - a.total).slice(0, 40)
      .map(({ cid, arr, total }) => ({
        id: 'cli_' + cid, tipo: 'grupo', label: nome.get(cid) || ('Cliente #' + cid), valor: Number(total.toFixed(2)), moeda: true, status: 'critico',
        hint: `${arr.length} título(s) vencido(s)`,
        filhos: arr.sort((a, b) => b.dias - a.dias).map((r) => ({
          id: 'tit_' + r.id, tipo: 'folha', label: r.documento || ('Título #' + r.id),
          hint: `${r.dias} dia(s) vencido · venc. ${new Date(r.vencimento).toISOString().slice(0, 10)}`,
          valor: Number(r.saldo.toFixed(2)), moeda: true, status: 'critico', rota: 'receber', alvo: String(cid), busca: nome.get(cid) || '',
        })),
      }));
    const totalVenc = vencidos.reduce((s, r) => s + r.saldo, 0);
    return { raiz: { id: 'faturamento', tipo: 'raiz', icone: '💰', label: 'Faturamento — inadimplência', valor: Number(totalVenc.toFixed(2)), moeda: true, status: totalVenc > 0 ? 'critico' : 'bom', hint: 'Maiores devedores primeiro. Clique para ver os títulos.', filhos } };
  }
}
