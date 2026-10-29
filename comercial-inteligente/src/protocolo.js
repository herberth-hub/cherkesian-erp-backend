'use strict';

/**
 * Protocolo de comunicação entre agentes (seção 7) e ciclo de vida de tarefas (seção 13).
 *
 * Garantias contra ciclos de delegação:
 *  1. delegação desce exatamente um nível; escalonamento sobe exatamente um nível;
 *  2. o que chegou por escalonamento não pode ser delegado para baixo — só decidido,
 *     devolvido com pedido de informação ou escalado de novo (até o humano, que encerra);
 *  3. profundidade máxima por árvore (config/hierarquia.json) e no máximo um
 *     escalonamento aberto por solicitação;
 *  4. toda solicitação tem prazo, responsável final e condição de conclusão.
 */

const H = require('./hierarquia');
const P = require('./permissoes');
const { ErroNegocio } = require('./erros');

const LIMITE_POR_ARVORE = 30;
const ABERTA = (s) => s.status !== 'concluida';

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function exigirTexto(v, campo) {
  if (!v || !String(v).trim()) throw new ErroNegocio('CAMPO_OBRIGATORIO', `Informe ${campo}.`);
  return String(v).trim();
}

function criarSolicitacao(base, e, hoje = hojeISO()) {
  const { agente, para, fluxo } = e;
  H.papel(agente);
  if (fluxo === 'delegacao') H.validarDelegacao(agente, para);
  else if (fluxo === 'escalonamento') H.validarEscalonamento(agente, para);
  else throw new ErroNegocio('FLUXO_INVALIDO', 'Fluxo deve ser "delegacao" ou "escalonamento".');

  const objetivo = exigirTexto(e.objetivo, 'o objetivo (--objetivo)');
  const resultadoEsperado = exigirTexto(e.resultadoEsperado, 'o resultado esperado (--resultado-esperado)');
  const prazo = exigirTexto(e.prazo, 'o prazo de resposta (--prazo AAAA-MM-DD)');
  if (prazo < hoje) throw new ErroNegocio('PRAZO_INVALIDO', `Prazo ${prazo} já passou (hoje: ${hoje}).`);

  let raizId;
  let profundidade = 0;
  let origem = null;
  if (e.origemId) {
    origem = base.exigir('solicitacao', e.origemId);
    if (origem.responsavel !== agente) {
      throw new ErroNegocio('NAO_RESPONSAVEL', `Só o responsável por ${origem.id} ("${origem.responsavel}") pode desdobrá-la.`);
    }
    if (!ABERTA(origem)) throw new ErroNegocio('SOLICITACAO_ENCERRADA', `${origem.id} já está concluída.`);
    if (origem.fluxo === 'escalonamento' && fluxo === 'delegacao') {
      throw new ErroNegocio(
        'CICLO_PROIBIDO',
        `${origem.id} chegou por escalonamento: "${agente}" deve decidir, pedir informação ou escalar — não delegar de volta para baixo.`,
      );
    }
    profundidade = origem.profundidade + 1;
    raizId = origem.raizId;
    if (profundidade > H.PROFUNDIDADE_MAXIMA) {
      throw new ErroNegocio('PROFUNDIDADE_EXCEDIDA', `Cadeia de ${origem.raizId} excedeu ${H.PROFUNDIDADE_MAXIMA} níveis.`);
    }
    const arvore = base.listar('solicitacao').filter((s) => s.raizId === raizId);
    if (arvore.length >= LIMITE_POR_ARVORE) {
      throw new ErroNegocio('LIMITE_SOLICITACOES', `A demanda ${raizId} já tem ${arvore.length} solicitações; consolide antes de abrir outra.`);
    }
    if (fluxo === 'escalonamento' && arvore.some((s) => s.origemId === origem.id && s.fluxo === 'escalonamento' && ABERTA(s))) {
      throw new ErroNegocio('ESCALONAMENTO_ABERTO', `${origem.id} já tem um escalonamento em aberto; aguarde a decisão.`);
    }
  }

  const id = base.proximoId('solicitacao');
  const sol = base.criar(
    'solicitacao',
    {
      solicitante: agente,
      responsavel: para,
      fluxo,
      raizId: raizId || id,
      origemId: origem ? origem.id : null,
      profundidade,
      referencia: e.referencia || null,
      objetivo,
      dadosDisponiveis: e.dadosDisponiveis || null,
      informacoesFaltantes: e.informacoesFaltantes || [],
      prazo,
      resultadoEsperado,
      status: 'pendente',
      respostas: [],
      decisao: null,
    },
    agente,
  );
  if (origem) {
    const status = fluxo === 'escalonamento' ? 'aguardando_aprovacao' : 'em_andamento';
    base.atualizar('solicitacao', origem.id, { status }, agente);
  }
  return sol;
}

function anexarResposta(sol, resposta) {
  return [...sol.respostas, { em: new Date().toISOString(), ...resposta }];
}

/** Quando um escalonamento é decidido, a solicitação de origem volta a andar com a decisão anexada. */
function retomarOrigem(base, filha, agente) {
  if (!filha.origemId) return;
  const origem = base.obter('solicitacao', filha.origemId);
  if (!origem || !ABERTA(origem)) return;
  const filhasAbertas = base.listar('solicitacao').some((s) => s.origemId === origem.id && ABERTA(s) && s.id !== filha.id);
  base.atualizar(
    'solicitacao',
    origem.id,
    {
      status: filhasAbertas ? origem.status : 'em_andamento',
      respostas: anexarResposta(origem, {
        tipo: 'informacao',
        por: agente,
        texto: `Retorno de ${filha.id} (${filha.fluxo}): ${filha.decisao}`,
      }),
    },
    agente,
  );
}

/**
 * Resposta do agente responsável: decisão, pedido de informação, escalonamento
 * (com justificativa) ou conclusão do trabalho delegado (com resultado).
 * O solicitante responde a pedidos de informação com tipo "informacao".
 */
function responderSolicitacao(base, { agente, id, tipo, texto, informacoesFaltantes = [], prazo }, hoje = hojeISO()) {
  const sol = base.exigir('solicitacao', id);
  const conteudo = exigirTexto(texto, 'o texto da resposta (--texto)');
  if (!ABERTA(sol)) throw new ErroNegocio('SOLICITACAO_ENCERRADA', `${id} já está concluída.`);

  if (tipo === 'informacao') {
    if (agente !== sol.solicitante) throw new ErroNegocio('NAO_RESPONSAVEL', `Só o solicitante ("${sol.solicitante}") complementa informações de ${id}.`);
    return base.atualizar('solicitacao', id, { status: 'em_andamento', respostas: anexarResposta(sol, { tipo, por: agente, texto: conteudo }) }, agente);
  }
  if (agente !== sol.responsavel) throw new ErroNegocio('NAO_RESPONSAVEL', `Só o responsável ("${sol.responsavel}") responde ${id}.`);

  switch (tipo) {
    case 'decisao': {
      const atual = base.atualizar(
        'solicitacao',
        id,
        { status: 'concluida', decisao: conteudo, respostas: anexarResposta(sol, { tipo, por: agente, texto: conteudo }) },
        agente,
      );
      retomarOrigem(base, atual, agente);
      return atual;
    }
    case 'conclusao':
      // Trabalho delegado entregue: só o solicitante encerra, após verificar (comando verificar).
      return base.atualizar(
        'solicitacao',
        id,
        { status: 'aguardando_aprovacao', decisao: conteudo, respostas: anexarResposta(sol, { tipo, por: agente, texto: conteudo }) },
        agente,
      );
    case 'pedido_informacao':
      return base.atualizar(
        'solicitacao',
        id,
        {
          status: 'aguardando_informacao',
          informacoesFaltantes: [...new Set([...sol.informacoesFaltantes, ...informacoesFaltantes])],
          respostas: anexarResposta(sol, { tipo, por: agente, texto: conteudo }),
        },
        agente,
      );
    case 'escalonamento': {
      const para = H.superior(agente);
      if (!para) throw new ErroNegocio('HIERARQUIA_ESCALONAMENTO', `"${agente}" não tem superior para escalar.`);
      const filha = criarSolicitacao(
        base,
        {
          agente,
          para,
          fluxo: 'escalonamento',
          origemId: id,
          referencia: sol.referencia,
          objetivo: `Decidir: ${sol.objetivo}`,
          dadosDisponiveis: `Justificativa do escalonamento: ${conteudo}${sol.dadosDisponiveis ? `\nDados: ${sol.dadosDisponiveis}` : ''}`,
          informacoesFaltantes: sol.informacoesFaltantes,
          prazo: prazo || sol.prazo,
          resultadoEsperado: 'Decisão registrada (aprovar, recusar ou condicionar) com justificativa.',
        },
        hoje,
      );
      const atual = base.obter('solicitacao', id);
      base.atualizar(
        'solicitacao',
        id,
        { respostas: anexarResposta(atual, { tipo, por: agente, texto: conteudo, escalonadaPara: filha.id }) },
        agente,
      );
      return filha;
    }
    default:
      throw new ErroNegocio('TIPO_RESPOSTA_INVALIDO', 'Tipo de resposta: decisao | conclusao | pedido_informacao | escalonamento | informacao.');
  }
}

/** O solicitante verifica o resultado entregue e encerra (ou devolve para ajuste). */
function verificarSolicitacao(base, { agente, id, aceitar, texto }) {
  const sol = base.exigir('solicitacao', id);
  if (agente !== sol.solicitante) throw new ErroNegocio('NAO_RESPONSAVEL', `Só o solicitante ("${sol.solicitante}") verifica ${id}.`);
  if (sol.status !== 'aguardando_aprovacao' || !sol.respostas.some((r) => r.tipo === 'conclusao')) {
    throw new ErroNegocio('TRANSICAO_INVALIDA', `${id} não tem entrega aguardando verificação.`);
  }
  const conteudo = exigirTexto(texto, 'a evidência da verificação (--texto)');
  const atual = base.atualizar(
    'solicitacao',
    id,
    {
      status: aceitar ? 'concluida' : 'em_andamento',
      respostas: anexarResposta(sol, { tipo: 'informacao', por: agente, texto: `${aceitar ? 'Verificado e aceito' : 'Devolvido para ajuste'}: ${conteudo}` }),
    },
    agente,
  );
  if (aceitar) retomarOrigem(base, atual, agente);
  return atual;
}

function listarSolicitacoes(base, { agente, status, hoje = hojeISO() } = {}) {
  return base
    .listar('solicitacao')
    .filter((s) => !agente || s.responsavel === agente || s.solicitante === agente)
    .filter((s) => !status || s.status === status)
    .map((s) => ({ ...s, vencida: ABERTA(s) && s.prazo < hoje }));
}

// ---------------------------------------------------------------- tarefas

const TRANSICOES = {
  pendente: ['em_andamento', 'aguardando_informacao', 'bloqueada', 'aguardando_aprovacao'],
  em_andamento: ['aguardando_informacao', 'aguardando_aprovacao', 'bloqueada', 'concluida'],
  aguardando_informacao: ['em_andamento', 'bloqueada'],
  aguardando_aprovacao: ['em_andamento', 'concluida', 'bloqueada'],
  bloqueada: ['em_andamento', 'pendente'],
  concluida: [],
};

function criarTarefa(base, e) {
  const dados = {
    titulo: exigirTexto(e.titulo, 'o título (--titulo)'),
    atribuidaPor: e.agente,
    responsavel: e.responsavel,
    responsavelId: e.responsavelId || null,
    solicitacaoId: e.solicitacaoId || null,
    referencia: e.referencia || null,
    prazo: exigirTexto(e.prazo, 'o prazo (--prazo)'),
    status: 'pendente',
    condicaoConclusao: exigirTexto(e.condicaoConclusao, 'a condição de conclusão (--condicao)'),
    verificacao: null,
  };
  P.podeCriar(e.agente, 'tarefa', dados);
  return base.criar('tarefa', dados, e.agente);
}

/**
 * Concluir exige evidência e verificação por quem atribuiu (ou superior a ele).
 * O executor entrega com "aguardando_aprovacao" + evidência.
 */
function moverTarefa(base, { agente, id, status, evidencia }) {
  const t = base.exigir('tarefa', id);
  P.podeAtualizar(agente, 'tarefa', t, { status });
  if (!(TRANSICOES[t.status] || []).includes(status)) {
    throw new ErroNegocio('TRANSICAO_INVALIDA', `Tarefa ${id}: "${t.status}" → "${status}" não é permitido.`);
  }
  const patch = { status };
  if (status === 'concluida') {
    const verificador = agente === t.atribuidaPor || agente === 'humano' || H.nivel(agente) > H.nivel(t.atribuidaPor);
    if (!verificador) {
      throw new ErroNegocio('VERIFICACAO_OBRIGATORIA', `Só quem atribuiu a tarefa ("${t.atribuidaPor}") a declara concluída, após verificar. Entregue com status aguardando_aprovacao.`);
    }
    patch.verificacao = { verificadoPor: agente, evidencia: exigirTexto(evidencia, 'a evidência verificada (--evidencia)'), em: new Date().toISOString() };
  }
  if (status === 'aguardando_aprovacao' || status === 'bloqueada') {
    exigirTexto(evidencia, status === 'bloqueada' ? 'o motivo do bloqueio (--evidencia)' : 'a evidência da entrega (--evidencia)');
  }
  if (evidencia) patch.ultimaEvidencia = String(evidencia).trim();
  return base.atualizar('tarefa', id, patch, agente);
}

module.exports = {
  criarSolicitacao,
  responderSolicitacao,
  verificarSolicitacao,
  listarSolicitacoes,
  criarTarefa,
  moverTarefa,
  TRANSICOES,
  LIMITE_POR_ARVORE,
};
