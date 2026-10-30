'use strict';

/**
 * Operações comerciais com regra de negócio: registro genérico com permissão,
 * propostas (preço autorizado, avaliação de margem, aprovação por alçada) e metas.
 */

const H = require('./hierarquia');
const P = require('./permissoes');
const { avaliarProposta } = require('./precificacao');
const { criarTarefa } = require('./protocolo');
const { ErroNegocio } = require('./erros');

const CONTROLE = ['id', 'criadoEm', 'atualizadoEm', 'criadoPor'];
const limpar = (d) => Object.fromEntries(Object.entries(d || {}).filter(([k]) => !CONTROLE.includes(k)));

function produtosPorId(base) {
  return Object.fromEntries(base.listar('produto').map((p) => [p.id, p]));
}

// ---------------------------------------------------------------- propostas

function prepararItens(base, agente, itens) {
  if (!Array.isArray(itens) || !itens.length) throw new ErroNegocio('VALIDACAO', 'Proposta precisa de ao menos um item.');
  const prods = produtosPorId(base);
  return itens.map((it, i) => {
    const p = it.produtoId ? prods[it.produtoId] : null;
    if (it.produtoId && !p) throw new ErroNegocio('NAO_ENCONTRADO', `Item ${i + 1}: produto ${it.produtoId} não existe.`);
    const temTabela = p && p.precoAutorizado != null;
    // Vendedor e gerente só trabalham com preço autorizado: nunca inventam preço.
    if (!temTabela && H.nivel(agente) < H.nivel('diretor')) {
      throw new ErroNegocio(
        'PRECO_NAO_AUTORIZADO',
        `Item ${i + 1} ("${it.descricao || (p && p.descricao) || 'sem descrição'}") não tem preço autorizado. ` +
          'Registre a pendência e escale a formação de preço (gerente → diretor). Não informe preço ao cliente.',
      );
    }
    const precoUnitario = it.precoUnitario != null ? Number(it.precoUnitario) : temTabela ? p.precoAutorizado : null;
    if (precoUnitario == null) throw new ErroNegocio('PRECO_NAO_AUTORIZADO', `Item ${i + 1}: informe o preço formado (sem tabela autorizada).`);
    const item = { ...it, precoUnitario, descricao: it.descricao || (p && p.descricao) };
    if (item.produtoId === undefined) item.produtoId = null;
    return item;
  });
}

function criarProposta(base, agente, dados) {
  P.podeCriar(agente, 'proposta', dados);
  const op = base.exigir('oportunidade', dados.oportunidadeId);
  const registro = {
    ...limpar(dados),
    itens: prepararItens(base, agente, dados.itens),
    status: 'rascunho',
    prazoEntrega: dados.prazoEntrega || { dias: null, confirmadoOperacao: false },
    avaliacao: null,
  };
  const prop = base.criar('proposta', registro, agente);
  if (['cotacao_solicitada', 'necessidade_levantada'].includes(op.etapa)) {
    base.atualizar('oportunidade', op.id, { etapa: 'proposta_em_preparacao' }, agente);
  }
  return prop;
}

function estrategica(base, proposta) {
  const op = base.obter('oportunidade', proposta.oportunidadeId);
  const cli = op && op.clienteId ? base.obter('cliente', op.clienteId) : null;
  return Boolean((op && op.estrategica) || (cli && cli.estrategico));
}

/** Avalia e grava o resultado na proposta (margem, desconto, alçada, pendências). */
function avaliar(base, agente, propostaId, hoje) {
  const prop = base.exigir('proposta', propostaId);
  const avaliacao = avaliarProposta(prop, {
    produtosPorId: produtosPorId(base),
    politica: base.politica(),
    estrategica: estrategica(base, prop),
    hoje,
  });
  base.atualizar('proposta', prop.id, { avaliacao: { ...avaliacao, em: new Date().toISOString(), por: agente } }, agente);
  return avaliacao;
}

function atualizarProposta(base, agente, id, patch) {
  const atual = base.exigir('proposta', id);
  P.podeAtualizar(agente, 'proposta', atual, patch);
  const novo = { ...limpar(patch) };
  const mudouCondicao = ['itens', 'premissasCusto', 'condicoesPagamento', 'prazoEntrega'].some((k) => k in patch);
  if (mudouCondicao) {
    if (atual.status === 'aguardando_aprovacao') {
      throw new ErroNegocio('APROVACAO_PENDENTE', `Proposta ${id} aguarda aprovação; não altere as condições antes da decisão.`);
    }
    if (['enviada', 'aceita', 'recusada'].includes(atual.status)) {
      throw new ErroNegocio('TRANSICAO_INVALIDA', `Proposta ${id} já foi ${atual.status}; crie uma revisão (nova proposta).`);
    }
    if (patch.itens) novo.itens = prepararItens(base, agente, patch.itens);
    novo.avaliacao = null; // condição mudou: avaliação e aprovação anteriores deixam de valer
    novo.status = 'rascunho';
  }
  if (patch.status === 'enviada') {
    if (atual.status !== 'aprovada') throw new ErroNegocio('TRANSICAO_INVALIDA', `Proposta ${id} precisa estar aprovada antes do envio.`);
    novo.enviadaEm = patch.enviadaEm || new Date().toISOString().slice(0, 10);
  }
  return base.atualizar('proposta', id, novo, agente);
}

// ---------------------------------------------------------------- aprovações

function solicitarAprovacao(base, agente, propostaId, hoje) {
  const prop = base.exigir('proposta', propostaId);
  if (prop.status !== 'rascunho') throw new ErroNegocio('TRANSICAO_INVALIDA', `Proposta ${propostaId} está "${prop.status}"; só rascunho vai para aprovação.`);
  const pendente = base.listar('aprovacao').find((a) => a.objetoId === propostaId && a.status === 'pendente');
  if (pendente) throw new ErroNegocio('APROVACAO_PENDENTE', `Já existe a aprovação ${pendente.id} pendente para ${propostaId}.`);
  const av = avaliar(base, agente, propostaId, hoje);
  const apr = base.criar(
    'aprovacao',
    {
      objetoTipo: 'proposta',
      objetoId: propostaId,
      solicitadoPor: agente,
      alcadaNecessaria: av.alcadaNecessaria,
      motivos: [...av.motivosAlcada, ...av.pendencias],
      status: 'pendente',
      decididoPor: null,
      decididoEm: null,
      justificativa: null,
    },
    agente,
  );
  base.atualizar('proposta', propostaId, { status: 'aguardando_aprovacao' }, agente);
  const proximoPasso =
    H.nivel(agente) >= H.nivel(av.alcadaNecessaria)
      ? `Dentro da sua alçada: decida com "aprovacao decidir --id ${apr.id}".`
      : `Fora da alçada de "${agente}": escale ao superior ("${H.superior(agente)}") referenciando ${apr.id}.`;
  return { aprovacao: apr, avaliacao: av, proximoPasso };
}

function decidirAprovacao(base, agente, { id, decisao, justificativa }, hoje) {
  const apr = base.exigir('aprovacao', id);
  if (apr.status !== 'pendente') throw new ErroNegocio('APROVACAO_ENCERRADA', `${id} já foi ${apr.status}.`);
  if (!['aprovada', 'recusada'].includes(decisao)) throw new ErroNegocio('DECISAO_INVALIDA', 'Decisão deve ser "aprovada" ou "recusada".');
  if (!justificativa || !String(justificativa).trim()) throw new ErroNegocio('CAMPO_OBRIGATORIO', 'Toda decisão exige justificativa (--justificativa).');

  let alcada = apr.alcadaNecessaria;
  if (apr.objetoTipo === 'proposta' && decisao === 'aprovada') {
    // Reavalia na hora da decisão: política ou custos podem ter mudado.
    const prop = base.exigir('proposta', apr.objetoId);
    const av = avaliarProposta(prop, { produtosPorId: produtosPorId(base), politica: base.politica(), estrategica: estrategica(base, prop), hoje });
    alcada = H.maiorPapel(alcada, av.alcadaNecessaria);
  }
  if (H.nivel(agente) < H.nivel(alcada)) {
    throw new ErroNegocio(
      'FORA_DA_ALCADA',
      `"${agente}" não tem alçada para decidir ${id} (exige "${alcada}"). Escale ao superior ("${H.superior(agente)}").`,
    );
  }
  const decidida = base.atualizar(
    'aprovacao',
    id,
    { status: decisao, decididoPor: agente, decididoEm: new Date().toISOString(), justificativa: String(justificativa).trim(), alcadaNecessaria: alcada },
    agente,
    { acao: 'decidir' },
  );
  if (apr.objetoTipo === 'proposta') {
    base.atualizar('proposta', apr.objetoId, { status: decisao === 'aprovada' ? 'aprovada' : 'rascunho' }, agente, { acao: 'decidir' });
  }
  return decidida;
}

// ---------------------------------------------------------------- metas

function definirMeta(base, agente, dados) {
  const reg = { ...limpar(dados), definidaPor: agente };
  P.podeCriar(agente, 'meta', reg);
  if (reg.nivel === 'empresa') {
    // Meta geral proposta pelo CEO (IA) só vale depois de aprovada pelo responsável humano.
    reg.status = agente === 'humano' ? reg.status || 'aprovada' : 'proposta';
    reg.metaPaiId = null;
  } else {
    if (!reg.metaPaiId) throw new ErroNegocio('CAMPO_OBRIGATORIO', 'Desdobramento exige a meta superior (metaPaiId).');
    const pai = base.exigir('meta', reg.metaPaiId);
    if (pai.status !== 'aprovada') throw new ErroNegocio('META_NAO_APROVADA', `Meta ${pai.id} ainda não foi aprovada; não desdobre meta pendente.`);
    if (pai.periodo !== reg.periodo) throw new ErroNegocio('VALIDACAO', `Período ${reg.periodo} difere da meta superior (${pai.periodo}).`);
    reg.status = 'aprovada';
  }
  return base.criar('meta', reg, agente);
}

/** Soma dos desdobramentos vs meta superior (cobertura). */
function coberturaMeta(base, metaId) {
  const pai = base.exigir('meta', metaId);
  const filhas = base.listar('meta').filter((m) => m.metaPaiId === metaId && m.status !== 'revogada');
  const soma = filhas.reduce((a, m) => a + m.faturamento, 0);
  return { meta: pai, filhas, soma, diferenca: Math.round((pai.faturamento - soma) * 100) / 100 };
}

function atualizarMeta(base, agente, id, patch) {
  const atual = base.exigir('meta', id);
  P.podeAtualizar(agente, 'meta', atual, patch);
  if (patch.status === 'aprovada' && atual.status !== 'aprovada' && atual.nivel === 'empresa' && agente !== 'humano') {
    throw new ErroNegocio('PERMISSAO_NEGADA', 'Meta geral da empresa só é aprovada pelo responsável humano.');
  }
  if ('nivel' in patch || 'metaPaiId' in patch || 'definidaPor' in patch) {
    throw new ErroNegocio('CAMPO_PROTEGIDO', 'Nível, meta superior e autoria da meta não mudam; revogue e crie outra.');
  }
  return base.atualizar('meta', id, limpar(patch), agente);
}

// ---------------------------------------------------------------- genérico

function registrar(base, agente, entidade, dados, hoje) {
  switch (entidade) {
    case 'proposta':
      return criarProposta(base, agente, dados);
    case 'meta':
      return definirMeta(base, agente, dados);
    case 'tarefa':
      return criarTarefa(base, { agente, ...dados, condicaoConclusao: dados.condicaoConclusao });
    case 'grupo':
    case 'empresa':
    case 'unidade':
    case 'comprador':
      return require('./contas').registrarConta(base, agente, entidade, limpar(dados));
    case 'oportunidade':
      P.podeCriar(agente, entidade, dados);
      return base.criar(entidade, require('./contas').conferirOportunidadeConta(base, limpar(dados)), agente);
    case 'solicitacao':
    case 'aprovacao':
    case 'historico':
      throw new ErroNegocio('USE_COMANDO_PROPRIO', `Use o comando específico para ${entidade}.`);
    default:
      P.podeCriar(agente, entidade, dados);
      return base.criar(entidade, limpar(dados), agente);
  }
}

function atualizar(base, agente, entidade, id, patch) {
  switch (entidade) {
    case 'proposta':
      return atualizarProposta(base, agente, id, patch);
    case 'meta':
      return atualizarMeta(base, agente, id, patch);
    case 'tarefa':
      if ('status' in patch) throw new ErroNegocio('USE_COMANDO_PROPRIO', 'Use "tarefa mover" para mudar o status da tarefa.');
    // fallthrough
    default: {
      const atual = base.exigir(entidade, id);
      P.podeAtualizar(agente, entidade, atual, patch);
      if (entidade === 'comprador') require('./contas').conferirComprador(base, { ...atual, ...limpar(patch) });
      if (entidade === 'oportunidade' && ['grupoId', 'unidadeId', 'canal', 'responsavelId'].some((k) => k in patch) && (atual.grupoId || patch.grupoId || patch.unidadeId)) {
        const conferida = require('./contas').conferirOportunidadeConta(base, { ...atual, ...limpar(patch) });
        return base.atualizar(entidade, id, { ...limpar(patch), grupoId: conferida.grupoId, canal: conferida.canal }, agente);
      }
      if (entidade === 'unidade') {
        // CNPJ, empresa e funcionários locais passam pelas mesmas conferências do cadastro.
        const conferida = require('./contas').conferirUnidade(base, { ...atual, ...limpar(patch) });
        return base.atualizar(entidade, id, { ...limpar(patch), empresaId: conferida.empresaId || null }, agente);
      }
      return base.atualizar(entidade, id, limpar(patch), agente);
    }
  }
}

module.exports = {
  registrar,
  atualizar,
  criarProposta,
  atualizarProposta,
  avaliar,
  solicitarAprovacao,
  decidirAprovacao,
  definirMeta,
  coberturaMeta,
  atualizarMeta,
  produtosPorId,
};
