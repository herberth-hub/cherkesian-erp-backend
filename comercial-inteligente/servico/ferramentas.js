'use strict';

/**
 * A única ferramenta dos agentes no serviço: a CLI comercial, com o papel e a base
 * impostos pelo servidor. Mesmas garantias do hook do Claude Code (guard-bash.js):
 * o agente não escolhe outro papel, não age como humano e não roda comandos exclusivos.
 */

const { executar } = require('../src/cli');

const EXCLUSIVOS_HUMANO = ['erp', 'demo'];
const FORCADOS = ['--agente', '--base', '--hoje'];
const LIMITE_SAIDA = 20000;

const DEFINICAO = {
  name: 'hc',
  description:
    'Executa a CLI comercial da HC Quality (node comercial-inteligente/bin/hc.js). Passe os argumentos como lista, ' +
    'ex.: ["pipeline","sem-follow-up"] ou ["registrar","atividade","--json","{...}"]. O papel (--agente), a base e a data ' +
    'são definidos pelo servidor — não os informe. Use ["ajuda"] para ver todos os comandos. ' +
    'Uma resposta "ERRO [CODIGO]" é regra de negócio: respeite-a e siga a orientação da mensagem.',
  input_schema: {
    type: 'object',
    properties: {
      argumentos: { type: 'array', items: { type: 'string' }, description: 'Argumentos da CLI, sem --agente/--base/--hoje.' },
    },
    required: ['argumentos'],
    additionalProperties: false,
  },
  strict: true,
};

/** Remove flags que só o servidor define e valida a lista. Lança Error com motivo legível. */
function sanitizar(argumentos) {
  if (!Array.isArray(argumentos) || !argumentos.length) throw new Error('Informe "argumentos" como lista não vazia.');
  if (argumentos.length > 60 || argumentos.some((a) => typeof a !== 'string' || a.length > 10000)) {
    throw new Error('Argumentos inválidos (máx. 60 itens de texto, até 10.000 caracteres cada).');
  }
  if (EXCLUSIVOS_HUMANO.includes(argumentos[0])) throw new Error(`Comando "${argumentos[0]}" é exclusivo do responsável humano.`);
  const limpos = [];
  for (let i = 0; i < argumentos.length; i++) {
    const a = argumentos[i];
    const flag = a.split('=')[0];
    if (FORCADOS.includes(flag)) {
      if (!a.includes('=') && i + 1 < argumentos.length && !argumentos[i + 1].startsWith('--')) i++;
      continue;
    }
    limpos.push(a);
  }
  return limpos;
}

/** Executa a CLI como `papel`. Nunca lança: erros voltam como texto para o agente. */
async function executarHc(papel, argumentos, { base, dataDir }) {
  let limpos;
  try {
    limpos = sanitizar(argumentos);
  } catch (e) {
    return { ok: false, saida: `ERRO [FERRAMENTA]: ${e.message}`, argumentos: argumentos };
  }
  const env = { ...process.env, HC_DATA_DIR: dataDir || '' };
  if (!dataDir) delete env.HC_DATA_DIR;
  const r = await executar([...limpos, '--agente', papel, '--base', base], env);
  const saida = r.saida.length > LIMITE_SAIDA ? `${r.saida.slice(0, LIMITE_SAIDA)}\n[... saída truncada em ${LIMITE_SAIDA} caracteres]` : r.saida;
  return { ok: r.codigo === 0, saida, argumentos: limpos };
}

module.exports = { DEFINICAO, sanitizar, executarHc, EXCLUSIVOS_HUMANO };
