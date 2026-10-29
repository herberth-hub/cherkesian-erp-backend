'use strict';

/**
 * Análises de carteira e pipeline. Funções puras sobre a base: não inventam
 * dados — quando falta informação, o item vai para a lista de dados ausentes.
 */

const { ETAPAS, ETAPAS_ABERTAS, QUALIFICACAO_PARA_COTACAO, CAMPOS_OBRIGATORIOS_OPORTUNIDADE } = require('./dominio');
const { normalizar, soDigitos } = require('./store');
const { r2 } = require('./precificacao');

const DIA = 86400000;
const dias = (de, ate) => Math.floor((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA);
const somarDias = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const vazio = (v) => v === undefined || v === null || v === '';
const PEDIDO_ATIVO = ['recebido', 'em_producao', 'pronto'];
const PEDIDO_FATURADO = ['faturado', 'expedido'];

function nomeCliente(base, op) {
  if (op.clienteId) {
    const c = base.obter('cliente', op.clienteId);
    return c ? c.razaoSocial : op.clienteId;
  }
  if (op.leadId) {
    const l = base.obter('lead', op.leadId);
    return l ? l.empresa : op.leadId;
  }
  return '—';
}

const filtrarResp = (lista, responsavelId) => (responsavelId ? lista.filter((r) => r.responsavelId === responsavelId) : lista);
const abertas = (base, responsavelId) => filtrarResp(base.listar('oportunidade').filter((o) => ETAPAS_ABERTAS.includes(o.etapa)), responsavelId);

/** Oportunidades abertas sem próximo passo, sem data de acompanhamento ou com follow-up vencido. */
function semFollowUp(base, { hoje, responsavelId } = {}) {
  return abertas(base, responsavelId)
    .map((o) => {
      const motivos = [];
      if (vazio(o.proximoPasso)) motivos.push('sem próximo passo');
      if (vazio(o.proximoPassoEm)) motivos.push('sem data de acompanhamento');
      else if (o.proximoPassoEm < hoje) motivos.push(`follow-up vencido desde ${o.proximoPassoEm}`);
      return { id: o.id, titulo: o.titulo, cliente: nomeCliente(base, o), responsavelId: o.responsavelId, etapa: o.etapa, motivos };
    })
    .filter((x) => x.motivos.length);
}

/** Oportunidades abertas sem contato há mais de N dias (ou sem registro de contato). */
function parados(base, { hoje, responsavelId, diasLimite }) {
  return abertas(base, responsavelId)
    .map((o) => ({
      id: o.id,
      titulo: o.titulo,
      cliente: nomeCliente(base, o),
      responsavelId: o.responsavelId,
      etapa: o.etapa,
      ultimoContatoEm: o.ultimoContatoEm,
      diasSemContato: o.ultimoContatoEm ? dias(o.ultimoContatoEm, hoje) : null,
    }))
    .filter((x) => x.diasSemContato === null || x.diasSemContato > diasLimite);
}

/** Campos obrigatórios e de qualificação ausentes por oportunidade aberta. */
function dadosAusentes(base, { responsavelId } = {}) {
  const idxCotacao = ETAPAS.indexOf('cotacao_solicitada');
  return abertas(base, responsavelId)
    .map((o) => {
      const faltando = CAMPOS_OBRIGATORIOS_OPORTUNIDADE.filter((c) => vazio(o[c]));
      if (ETAPAS.indexOf(o.etapa) >= idxCotacao) {
        const q = o.qualificacao || {};
        faltando.push(...QUALIFICACAO_PARA_COTACAO.filter((c) => vazio(q[c])).map((c) => `qualificacao.${c}`));
      }
      if (vazio(o.previsaoFechamentoEm)) faltando.push('previsaoFechamentoEm');
      return { id: o.id, titulo: o.titulo, cliente: nomeCliente(base, o), responsavelId: o.responsavelId, etapa: o.etapa, faltando };
    })
    .filter((x) => x.faltando.length);
}

/** Propostas enviadas sem resposta, aguardando aprovação ou perto do vencimento. */
function propostasPendentes(base, { hoje, premissas }) {
  return base
    .listar('proposta')
    .filter((p) => ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada'].includes(p.status))
    .map((p) => {
      const op = base.obter('oportunidade', p.oportunidadeId);
      const alertas = [];
      if (p.status === 'enviada' && p.enviadaEm && dias(p.enviadaEm, hoje) > premissas.diasPropostaSemResposta) {
        alertas.push(`sem resposta há ${dias(p.enviadaEm, hoje)} dias`);
      }
      if (p.validadeAte && p.validadeAte < hoje) alertas.push(`vencida em ${p.validadeAte}`);
      else if (p.validadeAte && dias(hoje, p.validadeAte) <= premissas.diasAlertaValidadeProposta) alertas.push(`vence em ${p.validadeAte}`);
      if (p.status === 'aguardando_aprovacao') alertas.push('aguardando aprovação');
      if (p.status === 'aprovada') alertas.push('aprovada, aguardando envio pelo responsável humano');
      if (p.status === 'rascunho' && !p.avaliacao) alertas.push('rascunho sem avaliação de margem');
      const valor = p.itens.reduce((a, i) => a + i.precoUnitario * i.quantidade, 0);
      return { id: p.id, oportunidadeId: p.oportunidadeId, cliente: op ? nomeCliente(base, op) : '—', responsavelId: op && op.responsavelId, status: p.status, valor: r2(valor), alertas };
    });
}

/** Possíveis duplicidades de clientes/leads (CNPJ ou nome normalizado) e de oportunidades abertas. */
function duplicidades(base) {
  const achados = [];
  const grupos = new Map();
  for (const [ent, campoNome] of [['cliente', 'razaoSocial'], ['lead', 'empresa']]) {
    for (const r of base.listar(ent)) {
      for (const chave of [soDigitos(r.cnpj) && `cnpj:${soDigitos(r.cnpj)}`, `nome:${normalizar(r[campoNome])}`].filter(Boolean)) {
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(r.id);
      }
    }
  }
  for (const [chave, ids] of grupos) {
    // Lead convertido em cliente é esperado ter o mesmo nome.
    const unicos = [...new Set(ids)];
    const leads = unicos.filter((i) => i.startsWith('LEA'));
    const naoConvertidos = leads.filter((i) => (base.obter('lead', i) || {}).status !== 'convertido');
    const relevantes = unicos.filter((i) => !i.startsWith('LEA')).concat(naoConvertidos);
    if (relevantes.length > 1) achados.push({ chave, ids: relevantes });
  }
  const ops = new Map();
  for (const o of base.listar('oportunidade').filter((x) => ETAPAS_ABERTAS.includes(x.etapa))) {
    const chave = `${o.clienteId || o.leadId}:${normalizar(o.titulo)}`;
    if (!ops.has(chave)) ops.set(chave, []);
    ops.get(chave).push(o.id);
  }
  for (const [chave, ids] of ops) if (ids.length > 1) achados.push({ chave: `oportunidade:${chave}`, ids });
  return achados;
}

/** Data da última compra: maior data de pedido não cancelado, ou o campo informado no cadastro. */
function ultimaCompra(base, clienteId) {
  const peds = base.listar('pedido').filter((p) => p.clienteId === clienteId && p.status !== 'cancelado');
  const doPedido = peds.map((p) => p.data).sort().pop() || null;
  const doCadastro = (base.obter('cliente', clienteId) || {}).ultimaCompraEm || null;
  return [doPedido, doCadastro].filter(Boolean).sort().pop() || null;
}

/** Clientes sem compra há mais de N dias (candidatos à reativação). */
function clientesInativos(base, { hoje, diasLimite }) {
  return base
    .listar('cliente')
    .filter((c) => c.status !== 'prospect')
    .map((c) => {
      const ult = ultimaCompra(base, c.id);
      return { id: c.id, razaoSocial: c.razaoSocial, segmento: c.segmento, status: c.status, ultimaCompraEm: ult, diasSemCompra: ult ? dias(ult, hoje) : null };
    })
    .filter((c) => c.diasSemCompra === null || c.diasSemCompra > diasLimite);
}

/** Pedidos em aberto com prazo vencido, próximo ou sem prazo. */
function pedidosEmRisco(base, { hoje, diasAlerta }) {
  return base
    .listar('pedido')
    .filter((p) => PEDIDO_ATIVO.includes(p.status))
    .map((p) => {
      const cli = base.obter('cliente', p.clienteId);
      let risco = null;
      if (!p.prazoEntrega) risco = 'sem prazo de entrega registrado';
      else if (p.prazoEntrega < hoje) risco = `ATRASADO desde ${p.prazoEntrega}`;
      else if (dias(hoje, p.prazoEntrega) <= diasAlerta) risco = `prazo em ${dias(hoje, p.prazoEntrega)} dia(s) (${p.prazoEntrega}) com status "${p.status}"`;
      return { id: p.id, numeroErp: p.numeroErp || null, cliente: cli ? cli.razaoSocial : p.clienteId, valorTotal: p.valorTotal, status: p.status, prazoEntrega: p.prazoEntrega || null, risco };
    })
    .filter((p) => p.risco);
}

/** Desempenho por responsável no período [inicio, fim]. */
function desempenhoPorVendedor(base, { inicio, fim }) {
  const agentes = base.listar('agente').filter((a) => a.papel === 'vendedor' || base.listar('oportunidade').some((o) => o.responsavelId === a.id));
  const noPeriodo = (d) => d && d >= inicio && d <= fim;
  return agentes.map((a) => {
    const ops = base.listar('oportunidade').filter((o) => o.responsavelId === a.id);
    const ganhas = ops.filter((o) => ['pedido_ganho', 'pos_venda'].includes(o.etapa) && noPeriodo(o.fechadoEm));
    const perdidas = ops.filter((o) => o.etapa === 'pedido_perdido' && noPeriodo(o.fechadoEm));
    const ativs = base.listar('atividade').filter((t) => t.responsavelId === a.id && noPeriodo(t.data));
    const opIds = new Set(ops.map((o) => o.id));
    const props = base.listar('proposta').filter((p) => opIds.has(p.oportunidadeId));
    const decididas = ganhas.length + perdidas.length;
    return {
      responsavelId: a.id,
      nome: a.nome,
      atividades: ativs.length,
      contatos: ativs.filter((t) => ['ligacao', 'email', 'reuniao', 'visita', 'whatsapp'].includes(t.tipo)).length,
      propostasEnviadas: props.filter((p) => noPeriodo(p.enviadaEm)).length,
      ganhas: ganhas.length,
      perdidas: perdidas.length,
      conversao: decididas ? r2((ganhas.length / decididas) * 100) : null,
      pipelineAberto: r2(ops.filter((o) => ETAPAS_ABERTAS.includes(o.etapa)).reduce((s, o) => s + (o.valorEstimado || 0), 0)),
      semValorEstimado: ops.filter((o) => ETAPAS_ABERTAS.includes(o.etapa) && vazio(o.valorEstimado)).length,
    };
  });
}

/** Faturamento confirmado (pedidos faturados/expedidos) no período. */
function faturamento(base, { inicio, fim }) {
  const peds = base.listar('pedido').filter((p) => PEDIDO_FATURADO.includes(p.status) && (p.faturadoEm || p.data) >= inicio && (p.faturadoEm || p.data) <= fim);
  return { total: r2(peds.reduce((s, p) => s + p.valorTotal, 0)), pedidos: peds.length };
}

/** Concentração de receita: participação dos maiores clientes nos pedidos não cancelados do período. */
function concentracao(base, { inicio, fim }) {
  const porCliente = {};
  for (const p of base.listar('pedido').filter((x) => x.status !== 'cancelado' && x.data >= inicio && x.data <= fim)) {
    porCliente[p.clienteId] = (porCliente[p.clienteId] || 0) + p.valorTotal;
  }
  const total = Object.values(porCliente).reduce((a, b) => a + b, 0);
  const ranking = Object.entries(porCliente)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => ({ clienteId: id, cliente: (base.obter('cliente', id) || {}).razaoSocial || id, valor: r2(v), participacao: total ? r2((v / total) * 100) : 0 }));
  const top = (n) => r2(ranking.slice(0, n).reduce((a, r) => a + r.participacao, 0));
  return { total: r2(total), ranking, top1: top(1), top3: top(3), top5: top(5) };
}

/**
 * Previsão de receita 30/60/90 dias:
 *  - CONFIRMADO: carteira de pedidos em aberto com prazo de entrega na janela;
 *  - ESTIMADO: pipeline aberto ponderado pela probabilidade da etapa (premissa),
 *    usando a previsão de fechamento. Oportunidade sem valor ou sem data fica fora e é listada.
 */
function previsao(base, { hoje, premissas }) {
  const janelas = [30, 60, 90].map((n) => ({ dias: n, ate: somarDias(hoje, n), carteiraConfirmada: 0, pipelinePonderado: 0, pipelineBruto: 0 }));
  for (const p of base.listar('pedido').filter((x) => PEDIDO_ATIVO.includes(x.status) && x.prazoEntrega)) {
    for (const j of janelas) if (p.prazoEntrega <= j.ate) j.carteiraConfirmada += p.valorTotal;
  }
  const foraDaPrevisao = [];
  for (const o of base.listar('oportunidade').filter((x) => ETAPAS_ABERTAS.includes(x.etapa))) {
    if (vazio(o.valorEstimado) || vazio(o.previsaoFechamentoEm)) {
      foraDaPrevisao.push({ id: o.id, titulo: o.titulo, falta: [vazio(o.valorEstimado) && 'valorEstimado', vazio(o.previsaoFechamentoEm) && 'previsaoFechamentoEm'].filter(Boolean) });
      continue;
    }
    const prob = premissas.probabilidadePorEtapa[o.etapa] || 0;
    for (const j of janelas) {
      if (o.previsaoFechamentoEm <= j.ate) {
        j.pipelinePonderado += o.valorEstimado * prob;
        j.pipelineBruto += o.valorEstimado;
      }
    }
  }
  const pedidosSemPrazo = base.listar('pedido').filter((x) => PEDIDO_ATIVO.includes(x.status) && !x.prazoEntrega).map((x) => x.id);
  return {
    janelas: janelas.map((j) => ({ ...j, carteiraConfirmada: r2(j.carteiraConfirmada), pipelinePonderado: r2(j.pipelinePonderado), pipelineBruto: r2(j.pipelineBruto) })),
    foraDaPrevisao,
    pedidosSemPrazo,
  };
}

/** Contagem e valor por etapa do funil. */
function funil(base, { responsavelId } = {}) {
  const ops = filtrarResp(base.listar('oportunidade'), responsavelId);
  return ETAPAS.map((e) => {
    const lista = ops.filter((o) => o.etapa === e);
    return { etapa: e, quantidade: lista.length, valor: r2(lista.reduce((s, o) => s + (o.valorEstimado || 0), 0)), semValor: lista.filter((o) => vazio(o.valorEstimado)).length };
  });
}

/** Realizado vs meta do período (somente metas aprovadas). */
function metas(base, { periodo }) {
  const [a, m] = periodo.split('-').map(Number);
  const inicio = `${periodo}-01`;
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const fat = faturamento(base, { inicio, fim });
  return base
    .listar('meta')
    .filter((x) => x.periodo === periodo)
    .map((x) => {
      let realizado = null;
      if (x.nivel === 'empresa') realizado = fat.total;
      else if (x.nivel === 'vendedor' && x.responsavelId) {
        realizado = r2(
          base
            .listar('pedido')
            .filter((p) => p.responsavelId === x.responsavelId && PEDIDO_FATURADO.includes(p.status) && (p.faturadoEm || p.data) >= inicio && (p.faturadoEm || p.data) <= fim)
            .reduce((s, p) => s + p.valorTotal, 0),
        );
      } else if (x.nivel === 'segmento' && x.segmento) {
        realizado = r2(
          base
            .listar('pedido')
            .filter((p) => PEDIDO_FATURADO.includes(p.status) && (p.faturadoEm || p.data) >= inicio && (p.faturadoEm || p.data) <= fim)
            .filter((p) => (base.obter('cliente', p.clienteId) || {}).segmento === x.segmento)
            .reduce((s, p) => s + p.valorTotal, 0),
        );
      }
      return { ...x, realizado, atingimento: realizado != null && x.faturamento ? r2((realizado / x.faturamento) * 100) : null };
    });
}

/** Margem das propostas aceitas cuja margem foi calculada (média ponderada pela receita líquida). */
function margemPropostasAceitas(base) {
  const aceitas = base.listar('proposta').filter((p) => p.status === 'aceita');
  const comMargem = aceitas.filter((p) => p.avaliacao && p.avaliacao.margem && p.avaliacao.margem.status === 'calculada');
  const rl = comMargem.reduce((s, p) => s + p.avaliacao.margem.receitaLiquida, 0);
  const mc = comMargem.reduce((s, p) => s + p.avaliacao.margem.margemContribuicao, 0);
  return { aceitas: aceitas.length, comMargemCalculada: comMargem.length, percentual: rl ? r2((mc / rl) * 100) : null };
}

/** Descontos concedidos em propostas avaliadas, com justificativa. */
function descontos(base) {
  return base
    .listar('proposta')
    .filter((p) => p.avaliacao && p.avaliacao.descontoPercent > 0)
    .map((p) => ({ id: p.id, status: p.status, descontoPercent: p.avaliacao.descontoPercent, justificativa: p.justificativaDesconto || null }));
}

function intervaloMes(hoje) {
  const inicio = `${hoje.slice(0, 7)}-01`;
  return { inicio, fim: hoje, periodo: hoje.slice(0, 7) };
}

module.exports = {
  dias,
  somarDias,
  intervaloMes,
  semFollowUp,
  parados,
  dadosAusentes,
  propostasPendentes,
  duplicidades,
  clientesInativos,
  pedidosEmRisco,
  desempenhoPorVendedor,
  faturamento,
  concentracao,
  previsao,
  funil,
  metas,
  margemPropostasAceitas,
  descontos,
  ultimaCompra,
};
