'use strict';

/**
 * Matriz de permissões por papel (princípio do menor privilégio).
 * Aplicada pela CLI em toda escrita; os subagentes nativos ainda passam pelo
 * hook bin/guard-bash.js, que impede que um papel se passe por outro.
 */

const { ErroNegocio } = require('./erros');
const H = require('./hierarquia');

const COMERCIAL_BASE = ['lead', 'contato', 'cliente', 'oportunidade', 'atividade', 'proposta', 'tarefa'];

const CRIAR = {
  vendedor: COMERCIAL_BASE,
  gerente: [...COMERCIAL_BASE, 'meta'],
  diretor: [...COMERCIAL_BASE, 'meta'],
  ceo: ['meta', 'tarefa'],
  humano: [...COMERCIAL_BASE, 'meta', 'produto', 'pedido', 'agente'],
};

const ATUALIZAR = {
  vendedor: ['lead', 'contato', 'cliente', 'oportunidade', 'atividade', 'proposta', 'tarefa'],
  gerente: ['lead', 'contato', 'cliente', 'oportunidade', 'atividade', 'proposta', 'tarefa', 'meta'],
  diretor: ['lead', 'contato', 'cliente', 'oportunidade', 'atividade', 'proposta', 'tarefa', 'meta'],
  ceo: ['meta', 'tarefa'],
  humano: [...COMERCIAL_BASE, 'meta', 'produto', 'pedido', 'agente'],
};

/** Ações exclusivas do responsável humano (nunca executadas por agente de IA). */
const EXCLUSIVO_HUMANO = [
  'decidir aprovação na alçada "humano"',
  'cadastrar/alterar preço autorizado, custo ou certificação de produto',
  'registrar pedido confirmado (exige evidência)',
  'marcar proposta como enviada ao cliente',
  'importar dados do ERP',
  'definir a política comercial e as alçadas',
];

function exigir(cond, codigo, msg) {
  if (!cond) throw new ErroNegocio(codigo, msg);
}

function podeCriar(papel, entidade, dados = {}) {
  H.papel(papel);
  exigir((CRIAR[papel] || []).includes(entidade), 'PERMISSAO_NEGADA', `Papel "${papel}" não pode criar "${entidade}".`);
  if (entidade === 'cliente' && papel === 'vendedor') {
    exigir(dados.status === 'prospect', 'PERMISSAO_NEGADA', 'Vendedor só cadastra cliente com status "prospect"; ativação vem do pedido confirmado.');
  }
  if (entidade === 'proposta') {
    exigir((dados.status || 'rascunho') === 'rascunho', 'PERMISSAO_NEGADA', 'Proposta nasce como "rascunho"; aprovação e envio têm fluxo próprio.');
  }
  if (entidade === 'tarefa') {
    const resp = dados.responsavel;
    exigir(
      resp === papel || H.subordinado(papel) === resp,
      'HIERARQUIA_DELEGACAO',
      `"${papel}" só atribui tarefa a si mesmo ou ao subordinado direto ("${H.subordinado(papel) || 'nenhum'}").`,
    );
  }
  if (entidade === 'meta' && papel !== 'humano') {
    validarMeta(papel, dados);
  }
}

/** Quem define cada nível de meta. A meta da empresa vem do CEO (ou do humano). */
const NIVEL_META_POR_PAPEL = {
  ceo: ['empresa'],
  diretor: ['diretor', 'gerente', 'segmento'],
  gerente: ['vendedor'],
};

function validarMeta(papel, dados) {
  const niveis = NIVEL_META_POR_PAPEL[papel] || [];
  exigir(
    niveis.includes(dados.nivel),
    'PERMISSAO_NEGADA',
    `Papel "${papel}" não define meta de nível "${dados.nivel}" (permitido: ${niveis.join(', ') || 'nenhum'}).`,
  );
}

function podeAtualizar(papel, entidade, atual, patch = {}) {
  H.papel(papel);
  exigir((ATUALIZAR[papel] || []).includes(entidade), 'PERMISSAO_NEGADA', `Papel "${papel}" não pode alterar "${entidade}".`);

  if (entidade === 'meta' && atual.definidaPor && papel !== 'humano') {
    exigir(
      H.nivel(papel) >= H.nivel(atual.definidaPor),
      'HIERARQUIA_META',
      `Meta ${atual.id} foi definida por "${atual.definidaPor}"; "${papel}" não altera meta de agente superior.`,
    );
  }
  if (entidade === 'proposta' && 'status' in patch && patch.status !== atual.status) {
    const s = patch.status;
    exigir(s !== 'aprovada', 'PERMISSAO_NEGADA', 'Status "aprovada" só é definido pela decisão de aprovação (comando aprovacao decidir).');
    exigir(s !== 'aguardando_aprovacao', 'PERMISSAO_NEGADA', 'Use "aprovacao solicitar" para pedir aprovação da proposta.');
    if (s === 'enviada') exigir(papel === 'humano', 'PERMISSAO_NEGADA', 'Somente o responsável humano registra o envio da proposta ao cliente.');
    if (s === 'aceita' || s === 'recusada') {
      exigir(atual.status === 'enviada', 'TRANSICAO_INVALIDA', 'Só proposta enviada pode ser aceita ou recusada.');
    }
  }
  if (entidade === 'oportunidade' && 'responsavelId' in patch && patch.responsavelId !== atual.responsavelId) {
    exigir(H.nivel(papel) >= H.nivel('gerente'), 'PERMISSAO_NEGADA', 'Redistribuição de carteira é do gerente comercial (ou acima).');
  }
  if (entidade === 'cliente' && papel === 'vendedor' && 'status' in patch && patch.status !== atual.status) {
    throw new ErroNegocio('PERMISSAO_NEGADA', 'Vendedor não altera o status do cliente.');
  }
  if (entidade === 'tarefa' && papel !== 'humano') {
    const envolvido = atual.responsavel === papel || atual.atribuidaPor === papel || H.nivel(papel) > H.nivel(atual.atribuidaPor);
    exigir(envolvido, 'PERMISSAO_NEGADA', `Tarefa ${atual.id} não pertence a "${papel}".`);
  }
}

module.exports = { CRIAR, ATUALIZAR, EXCLUSIVO_HUMANO, podeCriar, podeAtualizar, validarMeta, NIVEL_META_POR_PAPEL };
