'use strict';

const fs = require('fs');
const path = require('path');

/** Chaves cujo valor nunca vai para log ou relatório. */
const CHAVE_SENSIVEL = /(senha|password|token|secret|segredo|api[-_]?key|authorization|credencial|cookie)/i;
/** Valores com cara de segredo: JWT, Bearer, chaves sk-... */
const VALOR_SENSIVEL = /(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+|Bearer\s+\S+|sk-[\w-]{16,})/g;

function ocultar(valor, chave = '') {
  if (CHAVE_SENSIVEL.test(chave)) return '***';
  if (typeof valor === 'string') return valor.replace(VALOR_SENSIVEL, '***');
  if (Array.isArray(valor)) return valor.map((v) => ocultar(v));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, ocultar(v, k)]));
  }
  return valor;
}

/** Ocultação de argumentos de linha de comando: `--senha X` vira `--senha ***`. */
function ocultarArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.split('=');
    if (a.startsWith('--') && CHAVE_SENSIVEL.test(flag)) {
      if (inline !== undefined) out.push(`${flag}=***`);
      else {
        out.push(a);
        if (i + 1 < argv.length) {
          out.push('***');
          i++;
        }
      }
    } else out.push(ocultar(a));
  }
  return out;
}

/** Registro de execução em JSON Lines (um evento por linha). */
function registrar(dirBase, evento) {
  try {
    const dir = path.join(dirBase, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const linha = JSON.stringify(ocultar({ em: new Date().toISOString(), ...evento }));
    fs.appendFileSync(path.join(dir, 'execucao.jsonl'), linha + '\n');
  } catch {
    // Falha de log não pode derrubar a operação; o erro original segue para o chamador.
  }
}

module.exports = { ocultar, ocultarArgs, registrar };
