'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { SincronizacaoErp, configSincronizacao } = require('../servico/sincronizacao');
const { Orquestrador } = require('../servico/orquestrador');
const { Eventos } = require('../servico/eventos');
const { criarServidor } = require('../servico/servidor');
const { carregar } = require('../servico/config');
const { Base } = require('../src/store');
const { tmp, baseDemo } = require('./_util');

// Quinta 29/10/2026 — São Paulo = UTC-3
const QUI_0559 = new Date('2026-10-29T08:59:00Z');
const QUI_0600 = new Date('2026-10-29T09:00:00Z');
const SAB_0700 = new Date('2026-10-31T10:00:00Z');
const ENV_ERP = { ERP_API_URL: 'https://erp.invalid/api/v1', ERP_USUARIO: 'Agentes', ERP_SENHA: 'x' };

const CLIENTES = [{ id: 7, nome: 'Hospital Real', cnpjCpf: '11222333000181', clienteNovo: false }, { id: 8, nome: 'Hospital Real', cnpjCpf: '11222333000262', clienteNovo: false }];
const PRODUTOS = [{ id: 4, codigo: 'PRD-JAL-0001', categoria: 'Jaleco', descricao: 'Jaleco', precoBase: '89.90', custo: '35.00' }];
const PEDIDOS = [{ id: 9, numero: 'PV09', clienteId: 8, data: '2026-10-01T00:00:00Z', prazoEntrega: '2026-11-10T00:00:00Z', valorTotal: '5000.00', etapa: 'producao' }];
const LEADS = [{ id: 3, nome: 'Fulano', empresa: 'Clínica Nova', etapa: 'novo', valorEstimado: null, atualizadoEm: '2026-10-20T10:00:00Z' }];

function montar({ agora = QUI_0600, env = ENV_ERP, falhar = false } = {}) {
  const dir = path.join(tmp(), 'producao');
  const base = Base.abrir({ nome: 'producao', dir });
  const cfg = { ...carregar({ HC_MODO: 'simulado', HC_BASE: 'producao' }), dataDir: dir };
  const chamadas = [];
  const erpCliente = {
    get: async (c) => {
      chamadas.push(c);
      if (falhar) throw new Error('Login no ERP falhou (HTTP 401).');
      return { '/clientes': CLIENTES, '/produtos': PRODUTOS, '/pedidos': PEDIDOS, '/crm/leads': LEADS }[c];
    },
  };
  const eventos = new Eventos({});
  const s = new SincronizacaoErp({ cfg, dir, eventos, abrirBase: () => Base.abrir({ nome: 'producao', dir }), erpCliente, env, agora: () => agora });
  return { s, base, dir, cfg, chamadas, eventos };
}

test('configuração: diária às 06:00 nos dias úteis; pode desligar ou mudar o horário', () => {
  assert.deepEqual(configSincronizacao({}), { ativa: true, hora: '06:00', dias: [1, 2, 3, 4, 5] });
  assert.equal(configSincronizacao({ HC_ERP_SYNC: 'off' }).ativa, false);
  assert.equal(configSincronizacao({ HC_ERP_SYNC_HORA: '05:30' }).hora, '05:30');
  assert.equal(configSincronizacao({ HC_ERP_SYNC_HORA: 'cedo' }).hora, '06:00');
});

test('agenda: só depois do horário, em dia útil, uma vez por dia e com o ERP configurado', async () => {
  assert.equal(montar({ agora: QUI_0559 }).s.devidaAgora(), false);
  assert.equal(montar({ agora: SAB_0700 }).s.devidaAgora(), false);
  const { s } = montar();
  assert.equal(s.devidaAgora(), true);
  await s.executar('automatica');
  assert.equal(s.devidaAgora(), false, 'já rodou hoje');
  const semErp = new SincronizacaoErp({ cfg: montar().cfg, dir: tmp(), eventos: new Eventos({}), abrirBase: () => null, env: {}, agora: () => QUI_0600 });
  assert.equal(semErp.devidaAgora(), false, 'sem credenciais do ERP não agenda');
});

test('execução: clientes → produtos → pedidos; leads só com vendedor definido; resultado guardado', async () => {
  const { s, base, chamadas } = montar();
  const r1 = await s.executar('automatica');
  assert.deepEqual(chamadas, ['/clientes', '/produtos', '/pedidos'], 'leads pulados sem responsável');
  assert.equal(r1.ok, true);
  assert.match(r1.resultados.find((x) => x.recurso === 'leads').pulado, /vendedor responsável/);
  assert.equal(base.listar('cliente').length, 2, 'unidades com o mesmo nome entram');
  assert.equal(base.listar('pedido').length, 1);

  const vend = base.criar('agente', { nome: 'Sabrina', papel: 'vendedor', tipo: 'humano', ativo: true }, 'humano');
  s.definirResponsavel(vend.id);
  const r2 = await s.executar('manual');
  assert.ok(chamadas.includes('/crm/leads'));
  assert.equal(r2.resultados.find((x) => x.recurso === 'clientes').atualizados, 2, 'reimporta sem duplicar');
  assert.equal(r2.resultados.find((x) => x.recurso === 'leads').criados, 2, 'lead + oportunidade');
  const outra = new SincronizacaoErp({ cfg: montar().cfg, dir: s.arquivo.replace('/erp-sincronizacao.json', ''), eventos: new Eventos({}), abrirBase: () => base, env: ENV_ERP });
  assert.equal(outra.estado().responsavelLeads, vend.id, 'responsável persiste entre reinícios');
  assert.equal(outra.estado().ultima.origem, 'manual');
});

test('falha de conexão: para no primeiro recurso, avisa e não insiste no mesmo dia', async () => {
  const { s, chamadas, eventos } = montar({ falhar: true });
  const r = await s.executar('automatica');
  assert.equal(r.ok, false);
  assert.match(r.falhaGeral, /401/);
  assert.deepEqual(chamadas, ['/clientes']);
  assert.ok(eventos.recentes.some((e) => e.tipo === 'alerta' && /problemas/.test(e.texto)));
  assert.equal(s.devidaAgora(), false, 'automática não repete no mesmo dia (o botão permite repetir)');
});

test('base de demonstração não importa do ERP', async () => {
  const b = baseDemo();
  const cfg = { ...carregar({ HC_MODO: 'simulado', HC_BASE: 'demo' }), dataDir: b.dir };
  const s = new SincronizacaoErp({ cfg, dir: b.dir, eventos: new Eventos({}), abrirBase: () => b, erpCliente: { get: async () => [] }, env: ENV_ERP, agora: () => QUI_0600 });
  await assert.rejects(() => s.executar('manual'), /base de produção/);
});

test('orquestrador dispara às 06:00 mesmo fora do expediente dos agentes; painel sincroniza sob demanda', async () => {
  const { s, cfg, chamadas } = montar();
  const o = new Orquestrador({ cfg, eventos: new Eventos({}), executarJob: async () => ({}), sincronizacao: s, agora: () => QUI_0600 });
  o.carregarEstado();
  o.tick();
  await s.emAndamento;
  assert.ok(chamadas.includes('/clientes'), 'rodou às 06:00 (expediente abre 06:30)');

  const srv = criarServidor({ orquestrador: o, eventos: new Eventos({}), token: 'token-de-teste-1234567890', env: ENV_ERP });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const req = (caminho, metodo = 'GET') =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: caminho, method: metodo, headers: { Authorization: 'Bearer token-de-teste-1234567890', 'X-Painel': '1', 'Content-Type': 'application/json' } }, (res) => {
        let d = '';
        res.on('data', (x) => (d += x));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) }));
      });
      r.on('error', reject);
      if (metodo === 'POST') r.write('{}');
      r.end();
    });
  try {
    const sync = await req('/api/erp/sincronizar', 'POST');
    assert.equal(sync.status, 200);
    assert.equal(sync.json.origem, 'manual');
    const c = await req('/api/config');
    assert.equal(c.json.erp.sincronizacao.hora, '06:00');
    assert.equal(c.json.erp.sincronizacao.ultima.origem, 'manual');
  } finally {
    srv.close();
  }
});
