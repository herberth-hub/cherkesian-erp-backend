'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { CanalWhatsapp, configWhatsapp, normalizar, assinaturaMetaValida, SENSIVEL } = require('../servico/whatsapp');
const { criarExecutorClaude } = require('../servico/agente');
const { Orquestrador } = require('../servico/orquestrador');
const { Eventos } = require('../servico/eventos');
const { criarServidor } = require('../servico/servidor');
const { carregar } = require('../servico/config');
const { baseDemo, tmp } = require('./_util');

const META = { HC_WHATSAPP_PROVEDOR: 'meta', WHATSAPP_META_TOKEN: 'tok', WHATSAPP_META_PHONE_ID: '123', WHATSAPP_META_VERIFY_TOKEN: 'verifica-123', WHATSAPP_META_APP_SECRET: 'segredo-app' };
const ZAPI = { HC_WHATSAPP_PROVEDOR: 'zapi', ZAPI_INSTANCIA: 'inst', ZAPI_TOKEN: 'ztok', ZAPI_CLIENT_TOKEN: 'ctok', ZAPI_WEBHOOK_SEGREDO: 'segredo-zapi-123' };
const AGORA = new Date('2026-10-29T13:00:00Z');

function metaMsg(id, texto, { de = '5511999990001', nome = 'Cliente Teste', ts = AGORA } = {}) {
  return { entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: nome } }], messages: [{ id, from: de, timestamp: String(Math.floor(ts.getTime() / 1000)), type: 'text', text: { body: texto } }] } }] }] };
}

function provedorFalso() {
  const envios = [];
  const fetchImpl = async (url, op) => {
    envios.push({ url, headers: op.headers, corpo: JSON.parse(op.body) });
    return { ok: true, status: 200, text: async () => '' };
  };
  return { envios, fetchImpl };
}

function canal(env = META, opcoes = {}) {
  const p = provedorFalso();
  const eventos = new Eventos({});
  const c = new CanalWhatsapp({ dir: tmp(), eventos, env, fetchImpl: p.fetchImpl, agora: () => opcoes.agora || AGORA });
  return { c, p, eventos };
}

test('configuração: autonomia padrão é aprovação; valores inválidos são recusados', () => {
  assert.equal(configWhatsapp(META).autonomia, 'aprovacao');
  assert.equal(configWhatsapp({}).provedor, null);
  assert.throws(() => configWhatsapp({ HC_WHATSAPP_AUTONOMIA: 'total' }), /AUTONOMIA/);
  assert.throws(() => configWhatsapp({ HC_WHATSAPP_PROVEDOR: 'outro' }), /PROVEDOR/);
  assert.equal(canal(META).c.configurado(), true);
  assert.equal(canal({ ...META, WHATSAPP_META_APP_SECRET: '' }).c.configurado(), false, 'sem app secret não aceita webhook sem assinatura');
});

test('normalização: Meta (texto, botão, mídia) e Z-API (ignora as próprias mensagens e grupos)', () => {
  assert.deepEqual(normalizar(metaMsg('m1', 'Olá')).map((m) => [m.telefone, m.nome, m.texto]), [['5511999990001', 'Cliente Teste', 'Olá']]);
  const midia = normalizar({ entry: [{ changes: [{ value: { messages: [{ id: 'm2', from: '55', type: 'image' }] } }] }] });
  assert.match(midia[0].texto, /image recebido/);
  assert.equal(normalizar({ phone: '5511988887777', text: { message: 'Quero cotar' }, senderName: 'Ana', messageId: 'z1' })[0].texto, 'Quero cotar');
  assert.equal(normalizar({ phone: '5511988887777', text: { message: 'eco' }, fromMe: true }).length, 0);
  assert.equal(normalizar({ phone: '5511988887777', text: { message: 'grupo' }, isGroup: true }).length, 0);
});

test('assinatura da Meta: HMAC-SHA256 do corpo bruto com o app secret', () => {
  const corpo = Buffer.from('{"a":1}');
  const sig = `sha256=${crypto.createHmac('sha256', 'segredo-app').update(corpo).digest('hex')}`;
  assert.equal(assinaturaMetaValida(corpo, sig, 'segredo-app'), true);
  assert.equal(assinaturaMetaValida(corpo, sig, 'outro'), false);
  assert.equal(assinaturaMetaValida(corpo, undefined, 'segredo-app'), false);
});

test('recebimento: deduplica reentregas, respeita conversa assumida e avisa fora do horário só se configurado', async () => {
  const { c, p } = canal();
  const chamados = [];
  c.aoReceber = (t) => chamados.push(t);
  assert.deepEqual(await c.receber(metaMsg('m1', 'Quero 200 polos')), ['5511999990001']);
  assert.deepEqual(await c.receber(metaMsg('m1', 'Quero 200 polos')), [], 'mesma mensagem reentregue');
  assert.equal(c.conversa('5511999990001').mensagens.length, 1);
  c.assumir('5511999990001', true);
  assert.deepEqual(await c.receber(metaMsg('m2', 'Alô?')), [], 'conversa com o humano não vai ao agente');
  assert.deepEqual(chamados, ['5511999990001']);
  await c.receber(metaMsg('m3', 'Boa noite'), { dentroDoExpediente: false });
  assert.equal(p.envios.length, 0, 'sem mensagem configurada, nada é enviado fora do horário');

  const com = canal({ ...META, HC_WHATSAPP_MSG_FORA_HORARIO: 'Olá! Retornamos às 6h30.' });
  await com.c.receber(metaMsg('n1', 'Boa noite', { de: '5511900000002' }), { dentroDoExpediente: false });
  await com.c.receber(metaMsg('n2', 'Tem alguém?', { de: '5511900000002' }), { dentroDoExpediente: false });
  assert.equal(com.p.envios.length, 1, 'aviso uma vez por noite');
  assert.equal(com.p.envios[0].corpo.text.body, 'Olá! Retornamos às 6h30.');
});

test('portão de saída: aprovação por padrão; automático envia só o que não é sensível', async () => {
  const { c, p } = canal();
  await c.receber(metaMsg('m1', 'Oi'));
  const r = await c.responderComoAgente('5511999990001', 'Olá! Quantas peças e quais tamanhos?', 'vendedor');
  assert.equal(r.enviado, false);
  assert.ok(r.propostaId);
  assert.equal(p.envios.length, 0, 'modo aprovação não envia');

  const auto = canal({ ...META, HC_WHATSAPP_AUTONOMIA: 'automatico' });
  await auto.c.receber(metaMsg('m1', 'Oi'));
  assert.equal((await auto.c.responderComoAgente('5511999990001', 'Olá! Quantas peças e quais tamanhos?', 'vendedor')).enviado, true);
  assert.equal(auto.p.envios[0].url, 'https://graph.facebook.com/v23.0/123/messages');
  assert.deepEqual(auto.p.envios[0].corpo, { messaging_product: 'whatsapp', to: '5511999990001', type: 'text', text: { body: 'Olá! Quantas peças e quais tamanhos?' } });
  for (const t of ['O preço é R$ 54,00', 'Conseguimos desconto', 'Entrega em 15 dias úteis', 'Pagamento via boleto', 'Tem certificação?', 'Fica 45 reais a peça', 'Conseguimos entregar em 10 dias', 'Temos 300 em estoque', '12 mil o lote', 'Frete grátis']) {
    assert.ok(SENSIVEL.test(t), t);
    assert.equal((await auto.c.responderComoAgente('5511999990001', t, 'vendedor')).enviado, false, `sensível vai para aprovação: ${t}`);
  }
  assert.equal(auto.p.envios.length, 1);
  auto.c.assumir('5511999990001', true);
  const bloqueado = await auto.c.responderComoAgente('5511999990001', 'Oi', 'vendedor');
  assert.equal(bloqueado.enviado, false);
  assert.match(bloqueado.motivo, /assumida/);
});

test('aprovação humana: envia o texto editado; descartar; janela de 24 h da Meta', async () => {
  const { c, p } = canal();
  await c.receber(metaMsg('m1', 'Oi'));
  const { propostaId } = await c.responderComoAgente('5511999990001', 'Texto do agente', 'vendedor');
  const enviada = await c.aprovar(propostaId, 'Texto revisado por mim');
  assert.equal(enviada.status, 'enviada_editada');
  assert.equal(p.envios[0].corpo.text.body, 'Texto revisado por mim');
  await assert.rejects(() => c.aprovar(propostaId), /já tratada/);
  const { propostaId: p2 } = await c.responderComoAgente('5511999990001', 'Outro', 'vendedor');
  assert.equal(c.descartar(p2).status, 'descartada');

  const velho = canal(META, { agora: new Date(AGORA.getTime() + 25 * 3600 * 1000) });
  await velho.c.receber(metaMsg('v1', 'Oi', { ts: AGORA }));
  velho.c.conversa('5511999990001').ultimaClienteEm = AGORA.toISOString();
  await assert.rejects(() => velho.c.enviarTexto('5511999990001', 'Oi', 'humano'), /24 h/);
  const z = canal(ZAPI);
  await z.c.receber({ phone: '5511988887777', text: { message: 'Oi' }, messageId: 'z1' });
  await z.c.enviarTexto('5511988887777', 'Olá', 'humano');
  assert.match(z.p.envios[0].url, /api\.z-api\.io\/instances\/inst\/token\/ztok\/send-text/);
  assert.equal(z.p.envios[0].headers['Client-Token'], 'ctok');
});

test('orquestrador: mensagem vira trabalho do vendedor; nova mensagem durante o trabalho volta à fila; falhas têm limite', async () => {
  const { c, eventos } = canal();
  const cfg = { ...carregar({ HC_MODO: 'claude', HC_BASE: 'demo' }), dataDir: baseDemo().dir };
  let rodadas = 0;
  let falhar = false;
  const o = new Orquestrador({
    cfg,
    eventos,
    whatsapp: c,
    agora: () => AGORA,
    executarJob: async (papel, job) => {
      rodadas++;
      job.instrucao();
      if (rodadas === 1) await c.receber(metaMsg('m2', 'Esqueci: são 300 peças'));
      return { status: falhar ? 'erro' : 'concluido', resumo: '', tokens: 0 };
    },
  });
  await c.receber(metaMsg('m1', 'Quero cotar polos'));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rodadas, 2, 'releu a conversa depois da mensagem nova');
  assert.equal(c.precisaAgente('5511999990001'), false);
  assert.equal(o.enfileirarWhatsapp('5511999990001'), null, 'nada pendente');

  falhar = true;
  rodadas = 10;
  await c.receber(metaMsg('m3', 'E aí?'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(rodadas, 13, 'para após 3 falhas seguidas');
  assert.ok(eventos.recentes.some((e) => e.tipo === 'alerta' && /3 tentativas/.test(e.texto)));
});

test('executor: vendedor responde pelo portão (uma vez por rodada); outros papéis não têm a ferramenta', async () => {
  const { c } = canal();
  await c.receber(metaMsg('m1', 'Quero cotar'));
  const cfg = { ...carregar({ HC_MODO: 'claude', HC_BASE: 'demo' }), dataDir: baseDemo().dir };
  const uso = { input_tokens: 1, output_tokens: 1 };
  const roteiro = [
    { stop_reason: 'tool_use', usage: uso, content: [{ type: 'tool_use', id: 'w1', name: 'responder_whatsapp', input: { texto: 'Olá! Quantas peças?' } }] },
    { stop_reason: 'tool_use', usage: uso, content: [{ type: 'tool_use', id: 'w2', name: 'responder_whatsapp', input: { texto: 'De novo' } }] },
    { stop_reason: 'end_turn', usage: uso, content: [{ type: 'text', text: 'Respondido.' }] },
  ];
  const chamadas = [];
  const create = async (p) => (chamadas.push(p), roteiro[chamadas.length - 1]);
  const ctl = { deveParar: () => null, registrarTokens: () => {}, evento: () => {} };
  const job = { origem: 'whatsapp', titulo: 'WhatsApp', whatsapp: { telefone: '5511999990001' }, instrucao: () => c.instrucao('5511999990001') };
  const r = await criarExecutorClaude({ cfg, cliente: { messages: { create }, beta: { messages: { create } } }, whatsapp: c })('vendedor', job, ctl);
  assert.equal(r.status, 'concluido');
  assert.equal(c.estado().propostas.length, 1, 'uma proposta; a segunda foi recusada');
  assert.deepEqual(chamadas[0].tools.map((t) => t.name), ['hc', 'rascunho_email', 'responder_whatsapp']);
  assert.match(chamadas[0].messages[0].content, /<conversa_whatsapp>[\s\S]*Quero cotar[\s\S]*<\/conversa_whatsapp>/);
  const cG = async () => ({ stop_reason: 'end_turn', usage: uso, content: [{ type: 'text', text: 'ok' }] });
  const chamadasG = [];
  await criarExecutorClaude({ cfg, cliente: { messages: { create: async (p) => (chamadasG.push(p), cG()) }, beta: { messages: { create: async (p) => (chamadasG.push(p), cG()) } } }, whatsapp: c })('diretor', { origem: 't', titulo: 't', instrucao: 't' }, ctl);
  assert.deepEqual(chamadasG[0].tools.map((t) => t.name), ['hc']);
});

function requisitar(porta, caminho, { metodo = 'GET', cabecalhos = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, (res) => {
      let d = '';
      res.on('data', (x) => (d += x));
      res.on('end', () => resolve({ status: res.statusCode, corpo: d }));
    });
    r.on('error', reject);
    if (corpo) r.write(corpo);
    r.end();
  });
}

test('webhook e painel: verificação da Meta, assinatura obrigatória, aprovação e resposta humana', async () => {
  const TOKEN = 'token-de-teste-1234567890';
  const { c, p } = canal();
  const cfg = { ...carregar({ HC_MODO: 'simulado', HC_BASE: 'demo' }), dataDir: baseDemo().dir };
  const o = new Orquestrador({ cfg, eventos: new Eventos({}), whatsapp: c, executarJob: async () => ({}), agora: () => AGORA });
  const srv = criarServidor({ orquestrador: o, eventos: new Eventos({}), token: TOKEN });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const auth = { Authorization: `Bearer ${TOKEN}`, 'X-Painel': '1', 'Content-Type': 'application/json' };
  try {
    assert.equal((await requisitar(porta, '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verifica-123&hub.challenge=987')).corpo, '987');
    assert.equal((await requisitar(porta, '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=987')).status, 403);
    const corpo = JSON.stringify(metaMsg('m1', 'Quero orçamento de jalecos'));
    assert.equal((await requisitar(porta, '/webhook/whatsapp', { metodo: 'POST', corpo })).status, 401, 'sem assinatura');
    assert.equal((await requisitar(porta, '/webhook/whatsapp', { metodo: 'POST', corpo, cabecalhos: { 'X-Hub-Signature-256': 'sha256=00' } })).status, 401);
    const sig = `sha256=${crypto.createHmac('sha256', 'segredo-app').update(corpo).digest('hex')}`;
    assert.equal((await requisitar(porta, '/webhook/whatsapp', { metodo: 'POST', corpo, cabecalhos: { 'X-Hub-Signature-256': sig } })).status, 200);
    assert.equal(c.conversa('5511999990001').mensagens[0].texto, 'Quero orçamento de jalecos');

    const { propostaId } = await c.responderComoAgente('5511999990001', 'Olá! Quantos jalecos?', 'vendedor');
    const est = JSON.parse((await requisitar(porta, '/api/estado', { cabecalhos: auth })).corpo);
    assert.equal(est.whatsapp.propostas[0].id, propostaId);
    assert.equal((await requisitar(porta, '/api/whatsapp/aprovar', { metodo: 'POST', cabecalhos: auth, corpo: JSON.stringify({ id: propostaId, texto: 'Olá! Quantos jalecos e quais tamanhos?' }) })).status, 200);
    assert.equal(p.envios[0].corpo.text.body, 'Olá! Quantos jalecos e quais tamanhos?');
    assert.equal((await requisitar(porta, '/api/whatsapp/responder', { metodo: 'POST', cabecalhos: auth, corpo: JSON.stringify({ telefone: '5511999990001', texto: 'Aqui é o Herberth.' }) })).status, 200);
    assert.equal(c.conversa('5511999990001').estado, 'humano', 'escrever pelo painel assume a conversa');
    assert.equal((await requisitar(porta, '/api/whatsapp/assumir', { metodo: 'POST', cabecalhos: auth, corpo: JSON.stringify({ telefone: '5511999990001', assumir: false }) })).status, 200);
    assert.equal(c.conversa('5511999990001').estado, 'agente');
  } finally {
    srv.close();
  }

  // Z-API: segredo na URL
  const z = canal(ZAPI);
  const oz = new Orquestrador({ cfg, eventos: new Eventos({}), whatsapp: z.c, executarJob: async () => ({}) });
  const sz = criarServidor({ orquestrador: oz, eventos: new Eventos({}), token: TOKEN });
  await new Promise((r) => sz.listen(0, '127.0.0.1', r));
  try {
    const pz = sz.address().port;
    const cz = JSON.stringify({ phone: '5511988887777', text: { message: 'Oi' }, messageId: 'z1' });
    assert.equal((await requisitar(pz, '/webhook/whatsapp?segredo=errado', { metodo: 'POST', corpo: cz })).status, 401);
    assert.equal((await requisitar(pz, '/webhook/whatsapp?segredo=segredo-zapi-123', { metodo: 'POST', corpo: cz })).status, 200);
    assert.equal(z.c.conversa('5511988887777').mensagens.length, 1);
  } finally {
    sz.close();
  }
});

test('Meta: reação e sistema não viram mensagem; legenda de mídia entra; falha de entrega vira alerta; 9º dígito', async () => {
  const { normalizar, falhasEntrega, telefoneAlternativo } = require('../servico/whatsapp');
  const corpo = (msgs, statuses) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '551199990001', profile: { name: 'Ana' } }], messages: msgs, statuses } }] }] });
  const n = normalizar(corpo([
    { from: '551199990001', id: 'a', type: 'reaction', reaction: { emoji: '👍' } },
    { from: '551199990001', id: 'b', type: 'image', image: { caption: 'logo da empresa' } },
    { from: '551199990001', id: 'c', type: 'system', system: {} },
  ]));
  assert.deepEqual(n.map((x) => x.id), ['b']);
  assert.match(n[0].texto, /Legenda: logo da empresa/);
  const f = falhasEntrega(corpo([], [{ id: 'wamid.1', status: 'failed', recipient_id: '551199990001', errors: [{ code: 131047, title: 'Re-engagement message' }] }, { id: 'wamid.2', status: 'delivered', recipient_id: '551199990001' }]));
  assert.equal(f.length, 1);
  assert.match(f[0].erro, /131047/);
  assert.equal(telefoneAlternativo('551199990001'), '5511999990001');
  assert.equal(telefoneAlternativo('5511999990001'), '551199990001');
  assert.equal(telefoneAlternativo('14155550000'), null);
  const { c } = canal();
  await c.receber(corpo([], [{ id: 'wamid.9', status: 'failed', recipient_id: '5511999990001', errors: [{ code: 131047, title: 'Re-engagement message' }] }]));
  assert.match(c.conversa('5511999990001').mensagens.at(-1).texto, /NÃO entregue/);
});

test('aprovação em dobro (dois cliques) envia uma vez só', async () => {
  const { c, p } = canal();
  await c.receber(metaMsg('m1', 'Oi'));
  const r = await c.responderComoAgente('5511999990001', 'Olá! Quantas peças?', 'vendedor');
  const [a, b] = await Promise.allSettled([c.aprovar(r.propostaId), c.aprovar(r.propostaId)]);
  assert.equal([a, b].filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(p.envios.length, 1);
});
