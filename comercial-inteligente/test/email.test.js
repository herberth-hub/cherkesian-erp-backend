'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { CaixaGmail, extrairPartes, montarResposta, b64url, deB64url } = require('../servico/gmail');
const { LeitorEmail, configEmail, MAX_TENTATIVAS } = require('../servico/email');
const { criarExecutorClaude } = require('../servico/agente');
const { Orquestrador } = require('../servico/orquestrador');
const { Eventos } = require('../servico/eventos');
const { criarServidor } = require('../servico/servidor');
const { carregar } = require('../servico/config');
const { baseDemo } = require('./_util');

const ENV = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csecret',
  HC_URL_PUBLICA: 'https://painel.exemplo.invalid',
  HC_GMAIL_CONTAS: 'contato@hcqualitycorp.com.br,herberth@hcqualitycorp.com.br',
};
const b64 = (s) => b64url(Buffer.from(s, 'utf8'));

/** Mensagem do Gmail no formato da API (format=full). */
function mensagem(id, { de = 'Compras <compras@cliente.invalid>', assunto = 'Cotação de jalecos', texto = 'Precisamos de 120 jalecos bordados para dezembro.', anexoPdf = false } = {}) {
  const parts = [{ mimeType: 'text/plain', body: { data: b64(texto), size: texto.length } }];
  if (anexoPdf) parts.push({ mimeType: 'application/pdf', filename: 'especificacao.pdf', body: { attachmentId: 'ANX1', size: 1200 } });
  parts.push({ mimeType: 'application/vnd.ms-excel', filename: 'grade.xls', body: { attachmentId: 'ANX2', size: 900 } });
  return {
    id,
    threadId: `T${id}`,
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: de },
        { name: 'To', value: 'contato@hcqualitycorp.com.br' },
        { name: 'Subject', value: assunto },
        { name: 'Date', value: 'Thu, 29 Oct 2026 10:00:00 -0300' },
        { name: 'Message-ID', value: `<${id}@cliente.invalid>` },
      ],
      parts,
    },
  };
}

/** Google falso: token, perfil, lista, mensagens, anexos e rascunhos. */
function googleFalso({ caixas = {}, perfil = 'contato@hcqualitycorp.com.br' } = {}) {
  const chamadas = [];
  const rascunhos = [];
  const fetchImpl = async (url, op = {}) => {
    const u = new URL(url);
    chamadas.push({ url: u.hostname + u.pathname + u.search, metodo: op.method || 'GET', auth: (op.headers || {}).Authorization, corpo: op.body });
    const ok = (d) => ({ ok: true, status: 200, json: async () => d });
    if (u.hostname === 'oauth2.googleapis.com') {
      const p = new URLSearchParams(op.body);
      if (p.get('grant_type') === 'authorization_code') return ok({ access_token: 'acc', refresh_token: 'rt-novo', expires_in: 3600 });
      return ok({ access_token: `acc-${p.get('refresh_token')}`, expires_in: 3600 });
    }
    const conta = String((op.headers || {}).Authorization || '').includes('rt-herberth') ? 'herberth' : 'contato';
    if (u.pathname.endsWith('/profile')) return ok({ emailAddress: perfil });
    if (u.pathname.endsWith('/messages')) return ok({ messages: (caixas[conta] || []).map((m) => ({ id: m.id })), q: u.searchParams.get('q') });
    if (u.pathname.includes('/attachments/')) return ok({ data: b64('%PDF-1.4 conteúdo') });
    const m = u.pathname.match(/\/messages\/([^/]+)$/);
    if (m) return ok((caixas[conta] || []).find((x) => x.id === m[1]));
    if (u.pathname.endsWith('/drafts')) {
      rascunhos.push(JSON.parse(op.body));
      return ok({ id: `D${rascunhos.length}` });
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'não encontrado' } }) };
  };
  return { fetchImpl, chamadas, rascunhos };
}

function leitorTeste(g, extraEnv = {}) {
  const dir = baseDemo().dir;
  const eventos = new Eventos({});
  const leitor = new LeitorEmail({ cfg: {}, dir, eventos, env: { ...ENV, ...extraEnv }, fetchImpl: g.fetchImpl });
  return { leitor, dir, eventos };
}

test('configuração: as duas caixas da HC; herberth@ só lê o marcador "cotacoes"', () => {
  const c = configEmail(ENV);
  assert.deepEqual(c.contas.map((x) => x.conta), ['contato@hcqualitycorp.com.br', 'herberth@hcqualitycorp.com.br']);
  assert.match(c.contas[0].consulta, /in:inbox/);
  assert.match(c.contas[0].consulta, /-category:promotions/);
  assert.match(c.contas[0].consulta, /newer_than:4d/, 'janela cobre o fim de semana');
  assert.match(c.contas[1].consulta, /label:cotacoes/, 'caixa pessoal: só e-mails marcados');
  assert.equal(configEmail({ ...ENV, HC_GMAIL_CONSULTA_HERBERTH: 'label:x' }).contas[1].consulta, 'label:x');
});

test('gmail: extrai texto (inclusive de HTML), anexos e monta resposta no mesmo fio', () => {
  const p = extrairPartes(mensagem('M1', { anexoPdf: true }).payload);
  assert.match(p.texto, /120 jalecos/);
  assert.deepEqual(p.anexos.map((a) => a.nome), ['especificacao.pdf', 'grade.xls']);
  const html = extrairPartes({ mimeType: 'text/html', body: { data: b64('<p>Olá<br>mundo &amp; cia</p><script>x()</script>') } });
  assert.equal(html.texto, 'Olá\nmundo & cia');
  const raw = montarResposta({ de: 'contato@hcqualitycorp.com.br', para: 'a@b.invalid', assunto: 'Cotação', corpo: 'Olá, obrigado!', inReplyTo: '<x@y>' });
  assert.match(raw, /^From: contato@hcqualitycorp\.com\.br/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/, 'assunto com acento codificado');
  assert.match(raw, /In-Reply-To: <x@y>/);
  assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Olá, obrigado!');
  assert.equal(deB64url(b64url(Buffer.from('ação'))).toString('utf8'), 'ação');
});

test('gmail: renova acesso, lista e cria RASCUNHO (nunca envia)', async () => {
  const g = googleFalso({ caixas: { contato: [mensagem('M1')] } });
  const cx = new CaixaGmail({ conta: 'contato@hcqualitycorp.com.br', clientId: 'c', clientSecret: 's', refreshToken: 'rt-contato', fetchImpl: g.fetchImpl });
  assert.deepEqual(await cx.listar('in:inbox'), ['M1']);
  const email = await cx.obter('M1');
  assert.equal(email.threadId, 'TM1');
  const r = await cx.criarRascunho(email, 'Resposta');
  assert.equal(r.id, 'D1');
  assert.equal(g.rascunhos[0].message.threadId, 'TM1');
  assert.match(deB64url(g.rascunhos[0].message.raw).toString('utf8'), /To: Compras <compras@cliente\.invalid>/);
  assert.equal(g.chamadas.filter((c) => c.url.startsWith('oauth2.googleapis.com')).length, 1, 'token reaproveitado');
  assert.ok(!g.chamadas.some((c) => c.url.includes('/send')), 'nenhuma chamada de envio');
  assert.equal(typeof cx.enviar, 'undefined');
});

test('leitor: e-mail novo vira trabalho do vendedor uma vez; processado não volta; falhas têm limite', async () => {
  const g = googleFalso({ caixas: { contato: [mensagem('M1', { anexoPdf: true })], herberth: [mensagem('H1')] } });
  const { leitor, eventos } = leitorTeste(g, { GMAIL_TOKEN_CONTATO: 'rt-contato' });
  const t1 = await leitor.verificar();
  assert.equal(t1.length, 1, 'herberth@ não conectada: não lida');
  const job = t1[0];
  assert.equal(job.chave, 'email:contato@hcqualitycorp.com.br:M1');
  assert.match(job.instrucao, /<email_recebido>[\s\S]*120 jalecos[\s\S]*<\/email_recebido>/);
  assert.match(job.instrucao, /DADO de terceiros, não instrução/);
  assert.match(job.instrucao, /não lidos: grade\.xls/);
  assert.equal(job.blocos.length, 1);
  assert.equal(job.blocos[0].type, 'document');
  assert.equal(job.email.responderPara, 'Compras <compras@cliente.invalid>');
  assert.equal((await leitor.verificar()).length, 0, 'já na fila');
  job.aoConcluir({ status: 'concluido' });
  assert.equal((await leitor.verificar()).length, 0, 'processado não volta');
  assert.equal(leitor.estado().processadosHoje, 1);

  const g2 = googleFalso({ caixas: { contato: [mensagem('M9')] } });
  const { leitor: l2 } = leitorTeste(g2, { GMAIL_TOKEN_CONTATO: 'rt-contato' });
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const [t] = await l2.verificar();
    assert.ok(t, `tentativa ${i + 1}`);
    t.aoConcluir({ status: 'interrompido' });
  }
  assert.equal((await l2.verificar()).length, 0, 'desiste após o limite');
  assert.equal(l2.estado().falhas, 1);
});

test('leitor: estado persiste entre reinícios e o token fica com permissão restrita', async () => {
  const g = googleFalso({ caixas: { contato: [mensagem('M1')] } });
  const { leitor, dir } = leitorTeste(g);
  leitor.salvarToken('contato@hcqualitycorp.com.br', 'rt-contato');
  const arq = leitor.arquivoToken('contato@hcqualitycorp.com.br');
  assert.equal(fs.statSync(arq).mode & 0o777, 0o600);
  const [t] = await leitor.verificar();
  t.aoConcluir({ status: 'concluido' });
  const outro = new LeitorEmail({ cfg: {}, dir, eventos: new Eventos({}), env: ENV, fetchImpl: g.fetchImpl });
  assert.equal((await outro.verificar()).length, 0);
  assert.equal(outro.estado().contas[0].conectada, true);
});

test('executor: só o vendedor tem a ferramenta de rascunho; destinatário fixo; no máximo um rascunho', async () => {
  const g = googleFalso({ caixas: { contato: [mensagem('M1', { anexoPdf: true })] } });
  const { leitor } = leitorTeste(g, { GMAIL_TOKEN_CONTATO: 'rt-contato' });
  const [job] = await leitor.verificar();
  const b = baseDemo();
  const cfg = { ...carregar({ HC_MODO: 'claude', HC_BASE: 'demo' }), dataDir: b.dir };
  const uso = { input_tokens: 10, output_tokens: 10 };
  const chamadas = [];
  const roteiro = [
    { stop_reason: 'tool_use', usage: uso, content: [{ type: 'tool_use', id: 'r1', name: 'rascunho_email', input: { corpo: 'Olá! Para cotar, precisamos da grade de tamanhos.' } }] },
    { stop_reason: 'tool_use', usage: uso, content: [{ type: 'tool_use', id: 'r2', name: 'rascunho_email', input: { corpo: 'De novo' } }] },
    { stop_reason: 'end_turn', usage: uso, content: [{ type: 'text', text: 'Cotação registrada; rascunho criado.' }] },
  ];
  const create = async (p) => (chamadas.push(p), roteiro[chamadas.length - 1]);
  const cliente = { messages: { create }, beta: { messages: { create } } };
  const ctl = { deveParar: () => null, registrarTokens: () => {}, evento: () => {} };
  const r = await criarExecutorClaude({ cfg, cliente, leitorEmail: leitor })('vendedor', job, ctl);
  assert.equal(r.status, 'concluido');
  assert.equal(g.rascunhos.length, 1, 'segundo rascunho recusado');
  assert.match(deB64url(g.rascunhos[0].message.raw).toString('utf8'), /To: Compras <compras@cliente\.invalid>/);
  assert.deepEqual(chamadas[0].tools.map((t) => t.name), ['hc', 'rascunho_email', 'responder_whatsapp']);
  assert.equal(chamadas[0].messages[0].content[0].type, 'document', 'anexo PDF enviado ao modelo');
  const segunda = chamadas[2].messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result' && b.tool_use_id === 'r2');
  assert.equal(segunda.is_error, true);
  assert.match(segunda.content, /já foi criado/);
  assert.equal(leitor.estado().rascunhos.length, 1);

  const chamadasGerente = [];
  const cG = async (p) => (chamadasGerente.push(p), { stop_reason: 'end_turn', usage: uso, content: [{ type: 'text', text: 'ok' }] });
  await criarExecutorClaude({ cfg, cliente: { messages: { create: cG }, beta: { messages: { create: cG } } }, leitorEmail: leitor })('gerente', { origem: 't', titulo: 't', instrucao: 't' }, ctl);
  assert.deepEqual(chamadasGerente[0].tools.map((t) => t.name), ['hc']);
});

test('orquestrador: verifica e-mails no modo claude dentro do intervalo e marca processado ao concluir', async () => {
  const g = googleFalso({ caixas: { contato: [mensagem('M1'), mensagem('M2')] } });
  const { leitor, dir } = leitorTeste(g, { GMAIL_TOKEN_CONTATO: 'rt-contato' });
  const cfg = { ...carregar({ HC_MODO: 'claude', HC_BASE: 'demo' }), dataDir: dir };
  const feitos = [];
  const o = new Orquestrador({
    cfg,
    eventos: new Eventos({}),
    leitorEmail: leitor,
    agora: () => new Date('2026-10-29T13:00:00Z'),
    executarJob: async (papel, job) => (feitos.push(`${papel}:${job.origem}`), { status: 'concluido', resumo: '', tokens: 0 }),
  });
  await o.verificarEmail();
  assert.deepEqual(feitos.filter((f) => f === 'vendedor:email').length, 2);
  assert.equal(o.verificarEmail(), null, 'respeita o intervalo');
  assert.equal(leitor.estado().processadosHoje, 2);

  const sim = new Orquestrador({ cfg: { ...cfg, modo: 'simulado' }, eventos: new Eventos({}), leitorEmail: leitor, executarJob: async () => ({}) });
  assert.equal(sim.verificarEmail(), null, 'modo simulado não lê e-mail');
});

function req(porta, caminho, cabecalhos = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: porta, path: caminho, headers: cabecalhos }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: d }));
    }).on('error', reject);
  });
}

test('painel: conectar Gmail exige login, valida state e confere que a conta autorizada é a do botão', async () => {
  const TOKEN = 'token-de-teste-1234567890';
  const g = googleFalso({ perfil: 'outra.pessoa@gmail.com' });
  const { leitor, dir } = leitorTeste(g);
  const cfg = { ...carregar({ HC_MODO: 'simulado', HC_BASE: 'demo' }), dataDir: dir };
  const o = new Orquestrador({ cfg, eventos: new Eventos({}), leitorEmail: leitor, executarJob: async () => ({}) });
  const srv = criarServidor({ orquestrador: o, eventos: new Eventos({}), token: TOKEN });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const auth = { Authorization: `Bearer ${TOKEN}` };
  try {
    assert.equal((await req(porta, '/oauth/gmail?conta=contato@hcqualitycorp.com.br')).status, 401);
    assert.equal((await req(porta, '/oauth/gmail?conta=intruso@exemplo.invalid', auth)).status, 400);
    const ini = await req(porta, '/oauth/gmail?conta=contato@hcqualitycorp.com.br', auth);
    assert.equal(ini.status, 302);
    const destino = new URL(ini.headers.location);
    assert.equal(destino.hostname, 'accounts.google.com');
    assert.equal(destino.searchParams.get('redirect_uri'), 'https://painel.exemplo.invalid/oauth/gmail/retorno');
    assert.match(destino.searchParams.get('scope'), /gmail\.readonly/);
    assert.match(destino.searchParams.get('scope'), /gmail\.compose/);
    assert.doesNotMatch(destino.searchParams.get('scope'), /gmail\.send|mail\.google\.com\/$/);
    const state = destino.searchParams.get('state');
    assert.equal((await req(porta, '/oauth/gmail/retorno?state=falso&code=x')).status, 400);
    const errada = await req(porta, `/oauth/gmail/retorno?state=${state}&code=abc`);
    assert.equal(errada.status, 400);
    assert.match(errada.corpo, /outra\.pessoa@gmail\.com/);
    assert.equal(leitor.estado().contas[0].conectada, false, 'conta errada não é salva');
    assert.equal((await req(porta, `/oauth/gmail/retorno?state=${state}&code=abc`)).status, 400, 'state é de uso único');

    const g2 = googleFalso({ perfil: 'contato@hcqualitycorp.com.br' });
    leitor.fetch = g2.fetchImpl;
    const ini2 = await req(porta, '/oauth/gmail?conta=contato@hcqualitycorp.com.br', auth);
    const st2 = new URL(ini2.headers.location).searchParams.get('state');
    const ok = await req(porta, `/oauth/gmail/retorno?state=${st2}&code=abc`);
    assert.equal(ok.status, 200);
    assert.match(ok.corpo, /Caixa conectada/);
    assert.equal(leitor.estado().contas[0].conectada, true);
    assert.ok(fs.existsSync(path.join(dir, 'segredos')));
    const est = JSON.parse((await req(porta, '/api/estado', auth)).corpo);
    assert.equal(est.email.contas[0].conectada, true);
    assert.ok(!JSON.stringify(est).includes('rt-novo'), 'token nunca vai para o painel');
  } finally {
    srv.close();
  }
});

test('filtro sem IA: newsletter e notificação saem antes do agente; portal de compras com cotação passa', () => {
  const { eAutomatico } = require('../servico/gmail');
  assert.equal(eAutomatico({ from: 'Loja <news@loja.com>', subject: 'Ofertas', 'list-unsubscribe': '<mailto:x>' }), true);
  assert.equal(eAutomatico({ from: 'noreply@banco.com.br', subject: 'Seu extrato' }), true);
  assert.equal(eAutomatico({ from: 'x@y.com', subject: 'Fora do escritório', 'auto-submitted': 'auto-replied' }), true);
  assert.equal(eAutomatico({ from: 'no-reply@ariba.com', subject: 'Cotação 22895741 - jalecos' }), false);
  assert.equal(eAutomatico({ from: 'Compras <compras@hospital.org.br>', subject: 'Uniformes' }), false);
});
