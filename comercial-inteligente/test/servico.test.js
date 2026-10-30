'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { carregar } = require('../servico/config');
const { local, dentroDoExpediente } = require('../servico/horario');
const { vencidas, ROTINAS } = require('../servico/rotinas');
const { sanitizar, executarHc } = require('../servico/ferramentas');
const { criarExecutorClaude, criarExecutorSimulado } = require('../servico/agente');
const { Orquestrador, MAX_TENTATIVAS } = require('../servico/orquestrador');
const { Eventos } = require('../servico/eventos');
const { criarServidor } = require('../servico/servidor');
const C = require('../src/comercial');
const PR = require('../src/protocolo');
const { baseDemo } = require('./_util');

// Quinta-feira 29/10/2026. São Paulo = UTC-3.
const QUI_1000 = new Date('2026-10-29T13:00:00Z');
const QUI_0630 = new Date('2026-10-29T09:30:00Z');
const SAB_1000 = new Date('2026-10-31T13:00:00Z');
const SEX_1700 = new Date('2026-10-30T20:00:00Z');

function cfgTeste(dir, extra = {}) {
  const c = carregar({ HC_MODO: 'simulado', HC_BASE: 'demo', HC_DATA_DIR: dir });
  return { ...c, dataDir: dir, ...extra, limites: { ...c.limites, ...(extra.limites || {}) }, concorrencia: { ...c.concorrencia, ...(extra.concorrencia || {}) } };
}

/** Dublê do SDK: devolve respostas roteirizadas e registra os parâmetros recebidos. */
function clienteFalso(roteiro) {
  const chamadas = [];
  const create = async (params) => {
    chamadas.push(params);
    const r = roteiro[Math.min(chamadas.length - 1, roteiro.length - 1)];
    return typeof r === 'function' ? r(params, chamadas.length) : r;
  };
  return { chamadas, messages: { create }, beta: { messages: { create } } };
}
const uso = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ctlLivre = (eventos = []) => ({ deveParar: () => null, registrarTokens: () => {}, evento: (tipo, d) => eventos.push({ tipo, ...d }) });

test('expediente: seg–sex 06:30–22:00 no fuso de São Paulo', () => {
  const cfg = carregar({});
  assert.equal(local(QUI_0630, cfg.fuso).hora, '06:30');
  assert.equal(dentroDoExpediente(new Date('2026-10-29T09:29:00Z'), cfg), false);
  assert.equal(dentroDoExpediente(QUI_0630, cfg), true);
  assert.equal(dentroDoExpediente(new Date('2026-10-30T00:59:00Z'), cfg), true); // qui 21:59
  assert.equal(dentroDoExpediente(new Date('2026-10-30T01:00:00Z'), cfg), false); // qui 22:00
  assert.equal(dentroDoExpediente(SAB_1000, cfg), false);
});

test('config: sem chave da API o serviço entra em modo simulado; modelo padrão é o mais recente', () => {
  assert.equal(carregar({}).modo, 'simulado');
  assert.equal(carregar({ ANTHROPIC_API_KEY: 'x' }).modo, 'claude');
  assert.equal(carregar({}).modelo, 'claude-opus-5-5');
  assert.throws(() => carregar({ HC_MODO: 'outro' }), /HC_MODO/);
});

test('rotinas: horário fixo roda uma vez por dia; semanais só na sexta', () => {
  const cfg = carregar({});
  const exec = new Set();
  const v1 = vencidas(QUI_0630, cfg, exec).map((x) => x.rotina.id);
  assert.ok(v1.includes('vendedor-abertura'));
  for (const x of vencidas(QUI_0630, cfg, exec)) exec.add(`${x.rotina.id}@${x.slot}`);
  assert.ok(!vencidas(QUI_0630, cfg, exec).some((x) => x.rotina.id === 'vendedor-abertura'), 'não repete no mesmo dia');
  assert.ok(!vencidas(new Date('2026-10-29T11:00:00Z'), cfg, new Set()).some((x) => x.rotina.id === 'vendedor-abertura'), '08:00 já passou da tolerância');
  assert.ok(vencidas(SEX_1700, cfg, new Set()).some((x) => x.rotina.id === 'diretor-semanal'));
  assert.ok(!vencidas(new Date('2026-10-29T20:00:00Z'), cfg, new Set()).some((x) => x.rotina.id === 'diretor-semanal'));
  assert.equal(vencidas(SAB_1000, cfg, new Set()).length, 0);
  for (const r of ROTINAS) assert.ok(['ceo', 'diretor', 'gerente', 'vendedor'].includes(r.papel) && r.instrucao && r.simulado.length);
});

test('ferramenta: servidor impõe papel e base; agente não age como humano nem roda comandos exclusivos', async () => {
  assert.deepEqual(sanitizar(['listar', 'cliente', '--agente', 'humano', '--base', 'producao', '--hoje=2020-01-01']), ['listar', 'cliente']);
  assert.throws(() => sanitizar(['erp', 'importar']), /exclusivo/);
  assert.throws(() => sanitizar([]), /lista/);
  const b = baseDemo();
  const cfg = cfgTeste(b.dir);
  const r = await executarHc('vendedor', ['registrar', 'produto', '--json', '{"descricao":"x","categoria":"outro","precoAutorizado":1,"custoVariavelUnitario":1}', '--agente', 'humano'], cfg);
  assert.equal(r.ok, false);
  assert.match(r.saida, /PERMISSAO_NEGADA/);
  const ok = await executarHc('gerente', ['pipeline', 'sem-follow-up'], cfg);
  assert.equal(ok.ok, true);
  assert.match(ok.saida, /OPO-0002/);
});

test('executor claude: loop de ferramentas com modelo, raciocínio adaptativo, esforço, fallbacks e cache', async () => {
  const b = baseDemo();
  const cfg = cfgTeste(b.dir, { modo: 'claude' });
  const cliente = clienteFalso([
    { stop_reason: 'tool_use', usage: uso, content: [{ type: 'text', text: 'Vou ver o funil.' }, { type: 'tool_use', id: 't1', name: 'hc', input: { argumentos: ['pipeline', 'sem-follow-up'] } }] },
    { stop_reason: 'end_turn', usage: uso, content: [{ type: 'text', text: 'OPO-0002 e OPO-0003 sem follow-up. Dados fictícios.' }] },
  ]);
  const eventos = [];
  let tokens = 0;
  const executar = criarExecutorClaude({ cfg, cliente });
  const r = await executar('gerente', { origem: 'teste', titulo: 'Ronda', instrucao: 'Ronda de follow-up' }, { ...ctlLivre(eventos), registrarTokens: (n) => (tokens += n) });
  assert.equal(r.status, 'concluido');
  assert.match(r.resumo, /OPO-0002/);
  assert.equal(tokens, 300);
  const p = cliente.chamadas[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.thinking, { type: 'adaptive' });
  assert.equal(p.output_config.effort, 'medium');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.match(p.system[0].text, /Gerente Comercial/);
  assert.equal(p.tools[0].name, 'hc');
  const resultado = cliente.chamadas[1].messages[2].content[0];
  assert.equal(resultado.type, 'tool_result');
  assert.equal(resultado.tool_use_id, 't1');
  assert.match(resultado.content, /OPO-0002/);
  assert.ok(eventos.some((e) => e.tipo === 'ferramenta' && e.ok));
  assert.ok(eventos.some((e) => e.tipo === 'nota'));
});

test('executor claude: recusa, limite de iterações e interrupção param o trabalho', async () => {
  const b = baseDemo();
  const cfg = cfgTeste(b.dir, { modo: 'claude', limites: { iteracoesPorTarefa: 3 } });
  const job = { origem: 't', titulo: 't', instrucao: 't' };
  const recusa = criarExecutorClaude({ cfg, cliente: clienteFalso([{ stop_reason: 'refusal', usage: uso, content: [] }]) });
  assert.equal((await recusa('ceo', job, ctlLivre())).status, 'recusado');
  const semFim = clienteFalso([{ stop_reason: 'tool_use', usage: uso, content: [{ type: 'tool_use', id: 'x', name: 'hc', input: { argumentos: ['hierarquia'] } }] }]);
  assert.equal((await criarExecutorClaude({ cfg, cliente: semFim })('ceo', job, ctlLivre())).status, 'limite');
  assert.equal(semFim.chamadas.length, 3);
  const parado = await criarExecutorClaude({ cfg, cliente: semFim })('ceo', job, { ...ctlLivre(), deveParar: () => 'fim do expediente' });
  assert.equal(parado.status, 'interrompido');
});

function orquestradorTeste({ agora = QUI_1000, executarJob, extra = {} } = {}) {
  const b = baseDemo();
  const cfg = cfgTeste(b.dir, extra);
  const eventos = new Eventos({});
  const o = new Orquestrador({ cfg, executarJob, eventos, agora: () => agora });
  return { o, b, cfg, eventos };
}

test('paralelismo: os quatro agentes trabalham ao mesmo tempo (e o vendedor em até 3 frentes)', async () => {
  let ativos = 0;
  let pico = 0;
  const porAgente = {};
  const executarJob = async (papel) => {
    ativos++;
    porAgente[papel] = (porAgente[papel] || 0) + 1;
    pico = Math.max(pico, ativos);
    porAgente[`${papel}:pico`] = Math.max(porAgente[`${papel}:pico`] || 0, porAgente[papel]);
    await new Promise((r) => setTimeout(r, 60));
    ativos--;
    porAgente[papel]--;
    return { status: 'concluido', resumo: 'ok', tokens: 0 };
  };
  const { o } = orquestradorTeste({ executarJob });
  for (const p of ['ceo', 'diretor', 'gerente']) o.enfileirar(p, { chave: p, origem: 't', titulo: p, instrucao: '' });
  for (let i = 0; i < 4; i++) o.enfileirar('vendedor', { chave: `v${i}`, origem: 't', titulo: `v${i}`, instrucao: '' });
  const t0 = Date.now();
  await o.despachar();
  const duracao = Date.now() - t0;
  assert.equal(pico, 6, '3 diretoria + 3 vendedor simultâneos');
  assert.equal(porAgente['vendedor:pico'], 3);
  assert.ok(duracao < 60 * 3, `paralelo, não sequencial (${duracao}ms)`);
  assert.equal(o.agentes.vendedor.concluidos, 4);
});

test('fora do expediente nada começa; dentro, as rotinas vencidas entram na fila', async () => {
  const feitos = [];
  const executarJob = async (papel, job) => (feitos.push(`${papel}:${job.titulo}`), { status: 'concluido', resumo: '', tokens: 0 });
  const fora = orquestradorTeste({ agora: SAB_1000, executarJob });
  fora.o.carregarEstado();
  fora.o.tick();
  fora.o.enfileirar('ceo', { chave: 'x', origem: 't', titulo: 'x', instrucao: '' });
  await fora.o.despachar();
  assert.equal(feitos.length, 0);

  const dentro = orquestradorTeste({ agora: QUI_0630, executarJob });
  dentro.o.carregarEstado();
  dentro.o.tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(feitos.includes('vendedor:Abertura do dia do vendedor'));
  const n = feitos.length;
  dentro.o.tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(feitos.filter((f) => f.startsWith('vendedor:Abertura')).length, 1, 'rotina não repete');
  assert.ok(feitos.length >= n);
});

test('fila automática: escalonamento do vendedor vira trabalho do gerente, sem reprocessar e com limite de tentativas', async () => {
  const feitos = [];
  const { o, b, eventos } = orquestradorTeste({
    extra: { modo: 'claude' },
    executarJob: async (papel, job) => (feitos.push(`${papel}:${job.registro}`), { status: 'concluido', resumo: '', tokens: 0 }),
  });
  const s = PR.criarSolicitacao(b, { agente: 'vendedor', para: 'gerente', fluxo: 'escalonamento', objetivo: 'Desconto 5%', prazo: '2026-10-30', resultadoEsperado: 'Decisão' }, '2026-10-29');
  o.coletarDaBase();
  o.coletarDaBase();
  assert.equal(o.agentes.gerente.fila.length, 1, 'enfileirado uma vez');
  await o.despachar();
  assert.deepEqual(feitos, [`gerente:${s.id}`]);
  o.coletarDaBase();
  assert.equal(o.agentes.gerente.fila.length, 0, 'sem mudança no registro, não reprocessa');
  // registro muda sem ser resolvido: tenta de novo, até o limite diário
  for (let i = 0; i < MAX_TENTATIVAS + 2; i++) {
    const atual = o.abrirBase().obter('solicitacao', s.id);
    o.abrirBase().atualizar('solicitacao', s.id, { dadosDisponiveis: `rodada ${i} ${atual.atualizadoEm}` }, 'vendedor');
    await new Promise((r) => setTimeout(r, 2));
    o.coletarDaBase();
    await o.despachar();
  }
  assert.equal(feitos.length, MAX_TENTATIVAS, 'limite de tentativas por dia');
  assert.ok(eventos.recentes.some((e) => e.tipo === 'alerta' && e.texto.includes(s.id)), 'avisa o humano no painel');
  // solicitação decidida sai da fila definitivamente
  PR.responderSolicitacao(o.abrirBase(), { agente: 'gerente', id: s.id, tipo: 'decisao', texto: 'Decidido' }, '2026-10-29');
  o.tentativas.clear();
  o.coletarDaBase();
  assert.equal(o.agentes.gerente.fila.length, 0);
});

test('pausa e orçamento diário impedem novos trabalhos', async () => {
  const feitos = [];
  const executarJob = async (papel) => (feitos.push(papel), { status: 'concluido', resumo: '', tokens: 0 });
  const { o } = orquestradorTeste({ executarJob, extra: { limites: { tokensPorDia: 1000 } } });
  o.pausar('diretor');
  o.enfileirar('diretor', { chave: 'd', origem: 't', titulo: 'd', instrucao: '' });
  await o.despachar();
  assert.deepEqual(feitos, []);
  o.registrarTokens(1000);
  o.retomar('diretor');
  await o.despachar();
  assert.deepEqual(feitos, [], 'orçamento esgotado');
  assert.equal(o.agentes.diretor.fila.length, 1);
});

test('executor simulado roda os comandos da rotina pela CLI', async () => {
  const b = baseDemo();
  const cfg = cfgTeste(b.dir);
  const eventos = [];
  const r = await criarExecutorSimulado({ cfg, pausaMs: 0 })('gerente', ROTINAS.find((x) => x.id === 'gerente-follow-up'), ctlLivre(eventos));
  assert.equal(r.status, 'concluido');
  assert.equal(eventos.filter((e) => e.tipo === 'ferramenta' && e.ok).length, 2);
  assert.equal((await criarExecutorSimulado({ cfg })('gerente', { titulo: 'x' }, ctlLivre())).status, 'ignorado');
});

// ------------------------------------------------------------------ painel

function requisitar(porta, caminho, { metodo = 'GET', cabecalhos = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: d }));
    });
    req.on('error', reject);
    if (corpo) req.write(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    req.end();
  });
}

test('painel: token com "+" (base64 do Render) funciona mesmo quando o navegador troca por espaço', async () => {
  const TOKEN = 'abc+def/ghi=jkl+mno123456';
  const { o, eventos } = orquestradorTeste({ executarJob: async () => ({ status: 'concluido', resumo: '', tokens: 0 }) });
  const srv = criarServidor({ orquestrador: o, eventos, token: TOKEN });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const porta = srv.address().port;
    assert.equal((await requisitar(porta, '/?token=abc+def/ghi=jkl+mno123456')).status, 303, '+ cru na URL');
    assert.equal((await requisitar(porta, `/?token=${encodeURIComponent(TOKEN)}`)).status, 303, 'token codificado');
    assert.equal((await requisitar(porta, '/?token=abc+def/ghi=jkl+mno12345X')).status, 401, 'token errado continua recusado');
  } finally {
    srv.close();
  }
});

test('painel: autenticação, estado, CSRF, decisão humana e eventos ao vivo', async () => {
  const TOKEN = 'token-de-teste-1234567890';
  assert.throws(() => criarServidor({ orquestrador: {}, eventos: {}, token: 'curto' }), /PAINEL_TOKEN/);
  const { o, b, eventos } = orquestradorTeste({ executarJob: async () => ({ status: 'concluido', resumo: '', tokens: 0 }) });
  // proposta com margem abaixo da mínima → alçada humana
  const prop = C.registrar(b, 'diretor', 'proposta', { oportunidadeId: 'OPO-0004', itens: [{ produtoId: 'PRD-0003', quantidade: 100, precoUnitario: 30 }], premissasCusto: { impostosPercent: 9.25, comissaoPercent: 3, freteTotal: 0, outrosCustosVariaveis: 0 }, justificativaDesconto: 'teste' });
  const { aprovacao } = C.solicitarAprovacao(b, 'diretor', prop.id, '2026-10-29');
  assert.equal(aprovacao.alcadaNecessaria, 'humano');

  const srv = criarServidor({ orquestrador: o, eventos, token: TOKEN });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  try {
    const entrada = await requisitar(porta, '/');
    assert.equal(entrada.status, 401);
    assert.match(entrada.corpo, /<form method="post" action="\/entrar">/, 'tela de entrada com campo de senha');
    assert.equal((await requisitar(porta, '/api/estado')).status, 401);
    assert.equal((await requisitar(porta, '/?token=errado')).status, 401);
    const form = (senha) => requisitar(porta, '/entrar', { metodo: 'POST', cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' }, corpo: `senha=${encodeURIComponent(senha)}` });
    const errada = await form('senha-errada');
    assert.equal(errada.status, 401);
    assert.match(errada.corpo, /Senha incorreta/);
    const viaForm = await form(TOKEN);
    assert.equal(viaForm.status, 303);
    assert.match(viaForm.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
    const login = await requisitar(porta, `/?token=${TOKEN}`);
    assert.equal(login.status, 303);
    const ck = login.headers['set-cookie'][0];
    assert.match(ck, /HttpOnly; Secure; SameSite=Lax/, 'Lax: funciona ao abrir o link a partir de outro site');
    const pagina = await requisitar(porta, '/', { cabecalhos: { Cookie: ck.split(';')[0] } });
    assert.equal(pagina.status, 200);
    assert.match(pagina.corpo, /Diretoria Comercial de IA/);

    const auth = { Authorization: `Bearer ${TOKEN}` };
    const est = JSON.parse((await requisitar(porta, '/api/estado', { cabecalhos: auth })).corpo);
    assert.equal(est.agentes.length, 4);
    assert.equal(est.base, 'demo');
    assert.equal(est.dados.ficticia, true);
    assert.ok(est.dados.aprovacoes.some((a) => a.id === aprovacao.id && a.alcada === 'humano'));

    const semCsrf = await requisitar(porta, '/api/aprovacao', { metodo: 'POST', cabecalhos: { ...auth, 'Content-Type': 'application/json' }, corpo: { id: aprovacao.id, decisao: 'recusada', justificativa: 'x' } });
    assert.equal(semCsrf.status, 403);
    const semJust = await requisitar(porta, '/api/aprovacao', { metodo: 'POST', cabecalhos: { ...auth, 'X-Painel': '1' }, corpo: { id: aprovacao.id, decisao: 'aprovada', justificativa: '' } });
    assert.equal(semJust.status, 422);

    // SSE: abre o fluxo e espera o evento da decisão
    const recebido = new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: porta, path: '/api/eventos', headers: auth }, (res) => {
        res.on('data', (c) => {
          if (String(c).includes('decisao-humana')) {
            resolve(true);
            res.destroy();
          }
        });
      });
    });
    await new Promise((r) => setTimeout(r, 50));
    const dec = await requisitar(porta, '/api/aprovacao', { metodo: 'POST', cabecalhos: { ...auth, 'X-Painel': '1' }, corpo: { id: aprovacao.id, decisao: 'recusada', justificativa: 'Margem abaixo da mínima' } });
    assert.equal(dec.status, 200);
    assert.equal(JSON.parse(dec.corpo).decididoPor, 'humano');
    assert.equal(await recebido, true);

    const pausa = await requisitar(porta, '/api/pausar', { metodo: 'POST', cabecalhos: { ...auth, 'X-Painel': '1' }, corpo: { papel: 'vendedor' } });
    assert.equal(pausa.status, 200);
    assert.equal(o.agentes.vendedor.pausado, true);
  } finally {
    srv.close();
  }
});
