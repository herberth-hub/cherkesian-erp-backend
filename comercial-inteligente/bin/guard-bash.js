#!/usr/bin/env node
'use strict';

/**
 * Hook PreToolUse (Bash) dos subagentes comerciais. Dois modos (defesa em profundidade):
 *  - frontmatter do agente:  guard-bash.js <papel>
 *  - settings.json do projeto: guard-bash.js --auto  → identifica o subagente pelo campo agent_type
 *    da entrada do hook; chamadas fora dos agentes hc-* passam direto (exit 0).
 *
 * Só permite: node .../comercial-inteligente/bin/hc.js <comando> ... --agente <papel do próprio agente>
 * Bloqueia (exit 2, motivo no stderr → devolvido ao agente):
 *  - qualquer outro programa, encadeamento (; && || |), redirecionamento, subshell, expansão de variável;
 *  - --agente diferente do papel do agente (um papel não se passa por outro, nem pelo humano);
 *  - comandos exclusivos do responsável humano (erp, demo).
 */

const path = require('path');

const HC_REAL = path.resolve(__dirname, 'hc.js');
const PAPEIS = ['ceo', 'diretor', 'gerente', 'vendedor'];
const EXCLUSIVOS_HUMANO = ['erp', 'demo'];
const AGENTE_PAPEL = {
  'hc-ceo': 'ceo',
  'hc-diretor-comercial': 'diretor',
  'hc-gerente-comercial': 'gerente',
  'hc-vendedor-comercial': 'vendedor',
};

/** Papel do subagente a partir do agent_type (aceita prefixo de plugin, ex.: "x:hc-ceo"). */
function papelDoAgente(agentType) {
  if (!agentType) return null;
  const nome = String(agentType).split(':').pop();
  return AGENTE_PAPEL[nome] || null;
}
const PROIBIDO = /[;&|<>`\n\r]|\$[A-Za-z_{(]/;

/** Tokenização mínima com aspas simples/duplas (sem expansão). */
function tokenizar(cmd) {
  const tokens = [];
  let atual = '';
  let aspas = null;
  let tem = false;
  for (const ch of cmd) {
    if (aspas) {
      if (ch === aspas) aspas = null;
      else atual += ch;
    } else if (ch === '"' || ch === "'") {
      aspas = ch;
      tem = true;
    } else if (/\s/.test(ch)) {
      if (tem || atual) tokens.push(atual);
      atual = '';
      tem = false;
    } else {
      atual += ch;
      tem = true;
    }
  }
  if (aspas) return null;
  if (tem || atual) tokens.push(atual);
  return tokens;
}

function avaliar(papel, comando, cwd = process.cwd()) {
  if (!PAPEIS.includes(papel)) return `Hook mal configurado: papel "${papel}" inválido.`;
  const cmd = String(comando || '').trim();
  if (PROIBIDO.test(cmd)) return 'Comando bloqueado: encadeamento, redirecionamento, subshell ou expansão de variável não são permitidos aos agentes comerciais.';
  const t = tokenizar(cmd);
  if (!t) return 'Comando bloqueado: aspas não fechadas.';
  // O script precisa ser exatamente o hc.js deste repositório (não um homônimo em outro lugar).
  if (t[0] !== 'node' || !t[1] || path.resolve(cwd, t[1]) !== HC_REAL) {
    return 'Comando bloqueado: agentes comerciais só executam "node comercial-inteligente/bin/hc.js ...".';
  }
  const args = t.slice(2);
  if (EXCLUSIVOS_HUMANO.includes(args[0])) return `Comando "${args[0]}" é exclusivo do responsável humano.`;
  const idx = args.flatMap((a, i) => (a === '--agente' || a.startsWith('--agente=') ? [i] : []));
  if (idx.length !== 1) return `Informe exatamente um --agente ${papel}.`;
  const valor = args[idx[0]].includes('=') ? args[idx[0]].split('=')[1] : args[idx[0] + 1];
  if (valor !== papel) return `Este agente é "${papel}" e não pode agir como "${valor}".`;
  return null;
}

function principal() {
  const modoAuto = process.argv[2] === '--auto';
  let papel = modoAuto ? null : process.argv[2];
  let entrada = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (entrada += c));
  process.stdin.on('end', () => {
    let comando = '';
    let cwd;
    try {
      const dados = JSON.parse(entrada || '{}');
      if (dados.tool_name && dados.tool_name !== 'Bash') process.exit(0);
      comando = (dados.tool_input || {}).command;
      cwd = dados.cwd;
      if (modoAuto) {
        papel = papelDoAgente(dados.agent_type);
        if (!papel) process.exit(0); // não é um agente comercial: regra não se aplica
      }
    } catch {
      process.stderr.write('Hook: entrada inválida; comando bloqueado por segurança.\n');
      process.exit(2);
    }
    const motivo = avaliar(papel, comando, cwd || process.cwd());
    if (motivo) {
      process.stderr.write(motivo + '\n');
      process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) principal();

module.exports = { avaliar, tokenizar, papelDoAgente };
