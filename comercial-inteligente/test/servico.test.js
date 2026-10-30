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
  for (const r of ROTINAS) assert.ok(['ceo', 'diretor', 'gerente', 'vendedor', 'hunter'].includes(r.papel) && r.instrucao && r.simulado.length);
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
  assert.deepEqual(p.cache_control, { type: 'ephemeral' }, 'cache automático da conversa');
  assert.match(p.system[0].text, /Gerente Comercial/);
  assert.equal(p.tools[0].name, 'hc');
  const resultado = cliente.chamadas[1].messages[2].content[0];
  assert.equal(resultado.type, 'tool_result');
  assert.equal(resultado.tool_use_id, 't1');
  assert.match(resultado.content, /OPO-0002/);
  assert.ok(eventos.some((e) => e.tipo === 'ferramenta' && e.ok));
  assert.ok(eventos.some((e) => e.tipo === 'nota'));
});

test('custo: leitura de cache sai do contador de tokens e entra no custo a ~10%; rotina usa esforço baixo', async () => {
  const { custoUsd } = require('../servico/agente');
  const precos = carregar({}).precos;
  // 1M de entrada (US$ 4) + 100k de saída (US$ 2) + 1M de cache lido (US$ 0,20)
  assert.equal(Math.round(custoUsd({ input_tokens: 1e6, output_tokens: 1e5, cache_read_input_tokens: 1e6 }, precos) * 100) / 100, 6.2);
  const b = baseDemo();
  const cfg = cfgTeste(b.dir, { modo: 'claude' });
  const cliente = clienteFalso([{ stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 50000 }, content: [{ type: 'text', text: 'ok' }] }]);
  let regTokens = 0;
  let regUsd = 0;
  const r = await criarExecutorClaude({ cfg, cliente })('gerente', { origem: 'rotina', titulo: 't', instrucao: 't', esforco: 'low' }, { ...ctlLivre(), registrarTokens: (n, u) => ((regTokens += n), (regUsd += u)) });
  assert.equal(regTokens, 1500, 'cache lido não conta como token cheio');
  assert.ok(Math.abs(regUsd - (1000 * 4 + 500 * 20 + 50000 * 0.2) / 1e6) < 1e-9);
  assert.equal(r.usd, regUsd);
  assert.equal(cliente.chamadas[0].output_config.effort, 'low');
  const { o } = orquestradorTeste({ agora: QUI_0630, executarJob: async () => ({ status: 'concluido', resumo: '', tokens: 0 }) });
  o.carregarEstado();
  o.tick();
  const job = [...o.agentes.vendedor.ativos.values(), ...o.agentes.vendedor.fila][0];
  assert.equal(job.esforco, 'low', 'rotinas entram com esforço baixo');
});

test('saída para o agente: JSON compacto sem campos internos, mantendo null (dado ausente)', () => {
  const { compactar } = require('../servico/ferramentas');
  const bruto = JSON.stringify([{ id: 'OPO-0003', valorEstimado: null, criadoEm: 'x', atualizadoEm: 'y', criadoPor: 'humano', origem: 'demo', ficticio: true, qualificacao: { tipoUniforme: 'jaleco', localEntrega: null } }], null, 2);
  const c = compactar(bruto);
  assert.equal(c, '[{"id":"OPO-0003","valorEstimado":null,"qualificacao":{"tipoUniforme":"jaleco","localEntrega":null}}]');
  assert.ok(c.length < bruto.length / 2);
  assert.equal(compactar('# Relatório\n\n\n\nTexto'), '# Relatório\n\nTexto', 'texto passa (só tira linhas em branco repetidas)');
});

test('orçamento em US$: atingido o teto do dia, nada novo começa', async () => {
  const feitos = [];
  const { o } = orquestradorTeste({ executarJob: async (p) => (feitos.push(p), { status: 'concluido', resumo: '', tokens: 0 }), extra: { limites: { usdPorDia: 2 } } });
  o.registrarTokens(1000, 2.01);
  o.enfileirar('ceo', { chave: 'c', origem: 't', titulo: 'c', instrucao: '' });
  await o.despachar();
  assert.deepEqual(feitos, []);
  assert.equal(o.estado().tokens.usdHoje, 2.01);
  assert.equal(o.estado().tokens.usdLimite, 2);
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
    assert.equal(est.agentes.length, 5);
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

test('modo enxuto: rotinas, e-mails e tarefas usam o modelo de rotina com esforço baixo; custo pelo preço do modelo', async () => {
  const { precosDe } = require('../servico/config');
  const padrao = carregar({});
  assert.equal(padrao.modeloRotina, 'claude-opus-5-5', 'sem escolha, nada muda de modelo');
  assert.equal(padrao.limites.iteracoesPorTarefa, 8);
  const c = carregar({ HC_MODELO_ROTINA: 'claude-sonnet-5-5' });
  assert.equal(c.modeloRotina, 'claude-sonnet-5-5');
  assert.equal(precosDe(c, 'claude-sonnet-5-5').entrada, 2);
  assert.equal(precosDe(c, 'claude-opus-5-5').entrada, 4);

  const b = baseDemo();
  const cfg = { ...cfgTeste(b.dir, { modo: 'claude' }), modeloRotina: 'claude-haiku-5-5' };
  const cliente = clienteFalso([{ stop_reason: 'end_turn', usage: { input_tokens: 1e6, output_tokens: 0 }, content: [{ type: 'text', text: 'ok' }] }]);
  let usd = 0;
  const o = new Orquestrador({ cfg, eventos: new Eventos({}), executarJob: criarExecutorClaude({ cfg, cliente }), agora: () => QUI_1000 });
  const job = { origem: 'rotina', titulo: 'Ronda', instrucao: 'x', ...o.enxuto() };
  await criarExecutorClaude({ cfg, cliente })('gerente', job, { ...ctlLivre([]), registrarTokens: (n, custo) => (usd += custo) });
  const p = cliente.chamadas[0];
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.fallbacks, undefined, 'Haiku não tem fallback no servidor');
  assert.equal(Math.round(usd * 100) / 100, 0.1, '1M de entrada no Haiku 5.5 = US$ 0,10');

  const ronda = ROTINAS.filter((r) => r.id.startsWith('gerente-follow-up'));
  assert.deepEqual(ronda.map((r) => r.hora), ['11:00', '15:30'], 'duas rondas por dia (antes: a cada 2 h)');
});

test('painel: escalonamentos viram UM caso com a cadeia, opções e recomendação do agente', () => {
  const { visaoBase, extrairOpcoes } = require('../servico/servidor');
  const b = baseDemo();
  const hoje = '2026-10-29';
  const s1 = PR.criarSolicitacao(b, { agente: 'vendedor', para: 'gerente', fluxo: 'escalonamento', objetivo: 'Pregão pede margem de 34%. Preciso de decisão.', prazo: hoje, resultadoEsperado: 'Decisão' }, hoje);
  const s2 = PR.criarSolicitacao(b, { agente: 'gerente', para: 'diretor', fluxo: 'escalonamento', origemId: s1.id, objetivo: 'Fora da minha alçada.', prazo: hoje, resultadoEsperado: 'Decisão' }, hoje);
  const s3 = PR.criarSolicitacao(b, { agente: 'diretor', para: 'ceo', fluxo: 'escalonamento', origemId: s2.id, objetivo: 'Fora da minha alçada.', prazo: hoje, resultadoEsperado: 'Decisão' }, hoje);
  PR.criarSolicitacao(b, { agente: 'ceo', para: 'humano', fluxo: 'escalonamento', origemId: s3.id, objetivo: 'Pregão do Hospital (cliente estratégico). Opções: (A) participar com 34%; (B) declinar. Recomendo participar pelo volume.', prazo: hoje, resultadoEsperado: 'Decisão' }, hoje);
  const v = visaoBase(b, hoje);
  assert.equal(v.casos.length, 1, 'quatro saltos, um caso só');
  const c = v.casos[0];
  assert.equal(c.titulo, 'Pregão do Hospital (cliente estratégico).');
  assert.deepEqual(c.cadeia.map((x) => `${x.de}>${x.para}`), ['vendedor>gerente', 'gerente>diretor', 'diretor>ceo', 'ceo>humano']);
  assert.deepEqual(c.opcoes.map((o) => o.letra), ['A', 'B']);
  assert.match(c.recomendacao, /Recomendo participar/);
  assert.equal(c.urgente, true, 'prazo hoje');
  assert.equal(v.funil.length, 5);
  assert.deepEqual(extrairOpcoes('sem alternativas aqui'), []);
});

test('pipeline e escritório: quadro em 5 colunas com paradas e atividade do dia para o replay', () => {
  const fs = require('fs');
  const path = require('path');
  const { quadroFunil, atividadeDoDia } = require('../servico/servidor');
  const b = baseDemo();
  const q = quadroFunil(b);
  assert.deepEqual(q.colunas.map((c) => c.nome), ['Lead', 'Qualificado', 'Cotação', 'Proposta', 'Fechado']);
  assert.ok(q.cartoes.length > 0);
  for (const c of q.cartoes) {
    assert.ok(q.colunas.some((col) => col.nome === c.coluna && col.etapas.includes(c.etapa)));
    assert.equal(c.parada, c.coluna !== 'Fechado' && c.idadeDias > 5);
    assert.ok(c.cliente && c.cliente !== '—', `${c.id} com cliente ou lead`);
  }
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  fs.mkdirSync(path.join(b.dir, 'logs'), { recursive: true });
  const agora = new Date().toISOString();
  fs.writeFileSync(path.join(b.dir, 'logs', 'atividade.jsonl'), [
    JSON.stringify({ em: '2020-01-01T10:00:00Z', tipo: 'inicio', papel: 'gerente', titulo: 'velho', job: 'J0' }),
    JSON.stringify({ em: agora, tipo: 'inicio', papel: 'gerente', titulo: 'Reunião diária', job: 'J1' }),
    JSON.stringify({ em: agora, tipo: 'nota', papel: 'gerente', texto: 'ruído' }),
    JSON.stringify({ em: agora, tipo: 'fim', papel: 'gerente', titulo: 'Reunião diária', status: 'concluido', job: 'J1' }),
  ].join('\n') + '\n');
  const dia = atividadeDoDia(b, b.dir, hoje);
  assert.deepEqual(dia.eventos.map((e) => e.tipo), ['inicio', 'fim'], 'só hoje e só os tipos do replay');
  PR.criarSolicitacao(b, { agente: 'vendedor', para: 'gerente', fluxo: 'escalonamento', objetivo: 'Caso de hoje. Detalhe.', prazo: '2099-01-01', resultadoEsperado: 'x' }, hoje);
  assert.equal(atividadeDoDia(b, b.dir, hoje).solicitacoes.at(-1).resumo, 'Caso de hoje.');
});
