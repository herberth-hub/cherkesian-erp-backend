#!/usr/bin/env node
'use strict';

/**
 * Serviço autônomo da diretoria comercial: agentes em paralelo, expediente, rotinas e painel.
 *   node comercial-inteligente/bin/servico.js
 * Variáveis principais: PAINEL_TOKEN, ANTHROPIC_API_KEY (modo claude), HC_BASE, PORT.
 * Lista completa: comercial-inteligente/servico/README.md
 */

const crypto = require('crypto');
const { carregar } = require('../servico/config');
const { Eventos } = require('../servico/eventos');
const { Orquestrador } = require('../servico/orquestrador');
const { criarServidor } = require('../servico/servidor');
const { criarExecutorClaude, criarExecutorSimulado } = require('../servico/agente');
const { LeitorEmail } = require('../servico/email');
const { Base } = require('../src/store');

const cfg = carregar();
let token = cfg.painelToken;
if (!token) {
  token = crypto.randomBytes(24).toString('hex');
  console.warn('PAINEL_TOKEN não definido: gerado um token temporário para esta execução (defina PAINEL_TOKEN em produção).');
  console.warn(`Painel: http://localhost:${cfg.porta}/?token=${token}`);
}

const dir = Base.abrir({ nome: cfg.base, dir: cfg.dataDir }).dir;
const eventos = new Eventos({ dir });
const leitorEmail = new LeitorEmail({ cfg, dir, eventos });

let executarJob;
if (cfg.modo === 'claude') {
  const Anthropic = require('@anthropic-ai/sdk');
  const Cliente = Anthropic.default || Anthropic;
  executarJob = criarExecutorClaude({ cfg, cliente: new Cliente(), leitorEmail });
} else {
  executarJob = criarExecutorSimulado({ cfg });
}

const orquestrador = new Orquestrador({ cfg, executarJob, eventos, leitorEmail });
const servidor = criarServidor({ orquestrador, eventos, token });

servidor.listen(cfg.porta, () => {
  console.log(`Diretoria comercial no ar: porta ${cfg.porta} · modo ${cfg.modo} · base ${cfg.base} · modelo ${cfg.modo === 'claude' ? cfg.modelo : '—'}`);
  orquestrador.iniciar();
});

function encerrar(sinal) {
  console.log(`${sinal}: encerrando (trabalhos em andamento param na próxima verificação).`);
  orquestrador.pausar();
  orquestrador.parar();
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
