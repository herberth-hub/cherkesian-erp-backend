'use strict';

/** Regressões da varredura de falhas (cada teste reproduz um defeito encontrado e corrigido). */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const C = require('../src/comercial');
const K = require('../src/contas');
const PR = require('../src/protocolo');
const { carregar } = require('../servico/config');
const { Orquestrador } = require('../servico/orquestrador');
const { Eventos } = require('../servico/eventos');
const { criarServidor } = require('../servico/servidor');
const { SincronizacaoErp } = require('../servico/sincronizacao');
const { custoUsd } = require('../servico/agente');
const { baseDemo, baseVazia } = require('./_util');

const QUI_1000 = new Date('2026-10-29T13:00:00Z');

test('servidor: cookie ou URL malformados respondem erro sem derrubar o processo', async () => {
  const srv = criarServidor({ orquestrador: {}, eventos: {}, token: 'token-de-teste-1234567890' });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/', headers: { Cookie: 'hc_painel=%E0%A4%A' } }, (r) => resolve(r.statusCode)).on('error', reject);
    });
    assert.equal(status, 401);
    const linha = await new Promise((resolve) => {
      const c = net.connect(port, '127.0.0.1', () => c.write('GET http://[x HTTP/1.1\r\nHost: a\r\n\r\n'));
      c.on('data', (d) => { resolve(String(d).split('\r\n')[0]); c.destroy(); });
    });
    assert.match(linha, /400/);
    assert.ok(srv.listening, 'servidor continua no ar');
  } finally {
    srv.close();
  }
});

test('orquestrador: trabalho da base interrompido volta a ser coletado (não fica parado para sempre)', async () => {
  const b = baseDemo();
  const hoje = '2026-10-29';
  PR.criarSolicitacao(b, { agente: 'gerente', para: 'vendedor', fluxo: 'delegacao', objetivo: 'Levantar dados do cliente X', prazo: '2026-11-05', resultadoEsperado: 'Dados' }, hoje);
  let rodadas = 0;
  const cfg = { ...carregar({ HC_MODO: 'claude', HC_BASE: 'demo' }), dataDir: b.dir };
  const o = new Orquestrador({
    cfg,
    eventos: new Eventos({}),
    agora: () => QUI_1000,
    executarJob: async () => {
      rodadas++;
      return rodadas === 1 ? { status: 'interrompido', resumo: 'Interrompido: fim do expediente.', tokens: 0 } : { status: 'concluido', resumo: 'ok', tokens: 0 };
    },
  });
  o.abrirBase = () => b;
  o.carregarEstado();
  o.coletarDaBase();
  await o.despachar();
  for (let i = 0; i < 50 && rodadas < 2; i++) {
    o.coletarDaBase();
    await o.despachar();
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(rodadas >= 2, 'tentou de novo depois da interrupção');
});

test('permissões: agente não reescreve quem atribuiu ou quem responde pela tarefa', () => {
  const b = baseDemo();
  const t = C.registrar(b, 'gerente', 'tarefa', { titulo: 'Pesquisar grupo', responsavel: 'hunter', prazo: '2026-11-05', condicaoConclusao: 'Grupo registrado' }, '2026-10-29');
  assert.throws(() => C.atualizar(b, 'hunter', 'tarefa', t.id, { atribuidaPor: 'hunter' }), /não muda por atualização/);
  assert.throws(() => C.atualizar(b, 'hunter', 'tarefa', t.id, { responsavel: 'ceo' }), /não muda por atualização/);
});

test('grandes contas: o mesmo vendedor da negociação corporativa pode abrir a local; comprador "evidenciado" exige evidência também na atualização', () => {
  const b = baseVazia();
  const vend = b.criar('agente', { nome: 'Vendedora A', papel: 'vendedor', tipo: 'humano', ativo: true }, 'humano');
  const g = C.registrar(b, 'hunter', 'grupo', { nome: 'Grupo Teste Revisão', modeloCompra: 'centralizada' });
  const u = C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'CD Teste', tipo: 'centro_distribuicao', cidade: 'Cajamar' });
  const lead = C.registrar(b, 'vendedor', 'lead', { empresa: 'Grupo Teste Revisão', segmento: 'industria', fonte: 'hunter', status: 'qualificado' });
  const base = { leadId: lead.id, etapa: 'contato_realizado', valorEstimado: null, ultimoContatoEm: '2026-10-30', proximoPasso: 'Reunião', proximoPassoEm: '2026-11-05', responsavelId: vend.id };
  C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Corporativa', grupoId: g.id });
  const local = C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Local CD', unidadeId: u.id });
  assert.equal(local.canal, 'local');
  const c = C.registrar(b, 'hunter', 'comprador', { grupoId: g.id, nivel: 'corporativo', nome: 'Fulano', confirmacao: 'presumida_pelo_cargo' });
  assert.throws(() => C.atualizar(b, 'hunter', 'comprador', c.id, { confirmacao: 'evidenciada' }), /evidenciaFuncao/);
  assert.throws(() => C.atualizar(b, 'hunter', 'comprador', c.id, { nivel: 'local' }), /unidadeId/);
  assert.equal(K.verificarAbordagem(b, { unidadeId: u.id }).destaUnidade.length, 1);
});

test('custo: buscas na web do Hunter entram no teto em US$; base demo não agenda importação do ERP', () => {
  const precos = carregar({}).precos;
  assert.equal(Math.round(custoUsd({ input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 8 } }, precos) * 100) / 100, 0.08);
  const b = baseDemo();
  const s = new SincronizacaoErp({ cfg: { ...carregar({ HC_BASE: 'demo' }), dataDir: b.dir }, dir: b.dir, eventos: new Eventos({}), abrirBase: () => b, env: { ERP_API_URL: 'https://x.invalid/api/v1', ERP_USUARIO: 'a', ERP_SENHA: 'b' }, agora: () => QUI_1000 });
  assert.equal(s.devidaAgora(), false);
});
