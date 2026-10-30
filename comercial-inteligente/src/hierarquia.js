'use strict';

const path = require('path');
const { ErroNegocio } = require('./erros');

const CONFIG = require(path.join(__dirname, '..', 'config', 'hierarquia.json'));
const PAPEIS = CONFIG.papeis;
const PROFUNDIDADE_MAXIMA = CONFIG.limites.profundidadeMaximaSolicitacao;

function papel(p) {
  const def = PAPEIS[p];
  if (!def) throw new ErroNegocio('PAPEL_INVALIDO', `Papel desconhecido: "${p}". Use: ${Object.keys(PAPEIS).join(', ')}.`);
  return def;
}

const nivel = (p) => papel(p).nivel;
const superior = (p) => papel(p).superior;
const subordinado = (p) => papel(p).subordinado;
/** Subordinados diretos (o gerente tem dois: vendedor e hunter). */
const subordinados = (p) => papel(p).subordinados || (papel(p).subordinado ? [papel(p).subordinado] : []);

/** true se `a` está acima de `b` na cadeia (não necessariamente imediato). */
const acimaDe = (a, b) => nivel(a) > nivel(b);

/** Cadeia de escalonamento a partir de um papel, até o responsável humano. */
function cadeiaEscalonamento(p) {
  const cadeia = [p];
  let atual = superior(p);
  while (atual) {
    cadeia.push(atual);
    atual = superior(atual);
  }
  return cadeia;
}

/** Delegação só para o subordinado direto. */
function validarDelegacao(de, para) {
  papel(para);
  if (!subordinados(de).includes(para)) {
    throw new ErroNegocio(
      'HIERARQUIA_DELEGACAO',
      `"${de}" só pode delegar a subordinado direto ("${subordinados(de).join('", "') || 'nenhum'}"), não a "${para}".`,
    );
  }
}

/** Escalonamento só para o superior direto. */
function validarEscalonamento(de, para) {
  papel(para);
  if (superior(de) !== para) {
    throw new ErroNegocio(
      'HIERARQUIA_ESCALONAMENTO',
      `"${de}" só pode escalar ao superior direto ("${superior(de) || 'nenhum'}"), não a "${para}".`,
    );
  }
}

/** Papel com nível maior entre dois. */
const maiorPapel = (a, b) => (nivel(a) >= nivel(b) ? a : b);

module.exports = {
  CONFIG,
  PAPEIS,
  PROFUNDIDADE_MAXIMA,
  papel,
  nivel,
  superior,
  subordinado,
  subordinados,
  acimaDe,
  cadeiaEscalonamento,
  validarDelegacao,
  validarEscalonamento,
  maiorPapel,
};
