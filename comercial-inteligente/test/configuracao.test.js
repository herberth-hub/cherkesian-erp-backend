'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { validarPolitica, salvarPolitica } = require('../src/politica');
const C = require('../src/comercial');
const { Orquestrador } = require('../servico/orquestrador');
const { Eventos } = require('../servico/eventos');
const { criarServidor } = require('../servico/servidor');
const { carregar } = require('../servico/config');
const { baseDemo, baseVazia, cli, lancaCodigo, tmp } = require('./_util');

const VALIDA = {
  configurado: true,
  margemMinimaPercent: '18',
  premissasPadrao: { impostosPercent: '9,25', comissaoPercent: '3' },
  validadePropostaDias: '15',
  alcadas: {
    vendedor: { descontoMaxPercent: '3', margemMinimaPercent: '35', valorMaximoProposta: '20000' },
    gerente: { descontoMaxPercent: '7', margemMinimaPercent: '30', valorMaximoProposta: '60000' },
    diretor: { descontoMaxPercent: '12', margemMinimaPercent: '25', valorMaximoProposta: '' },
    ceo: { descontoMaxPercent: '18', margemMinimaPercent: '20', valorMaximoProposta: '' },
  },
};

test('política: aceita vírgula decimal e campos vazios como "sem valor"', () => {
  const p = validarPolitica(VALIDA);
  assert.equal(p.premissasPadrao.impostosPercent, 9.25);
  assert.equal(p.alcadas.diretor.valorMaximoProposta, null);
  assert.equal(p.configurado, true);
});

test('política: recusa alçadas incoerentes com a hierarquia', () => {
  const desc = structuredClone(VALIDA);
  desc.alcadas.vendedor.descontoMaxPercent = '10';
  assert.match(lancaCodigo(() => validarPolitica(desc), 'POLITICA_INVALIDA').message, /Desconto máximo do Vendedor \(10%\) não pode ser maior que o do Gerente/);
  const marg = structuredClone(VALIDA);
  marg.alcadas.gerente.margemMinimaPercent = '40';
  assert.match(lancaCodigo(() => validarPolitica(marg), 'POLITICA_INVALIDA').message, /Margem mínima do Vendedor \(35%\) não pode ser menor que a do Gerente/);
  const abaixo = structuredClone(VALIDA);
  abaixo.alcadas.ceo.margemMinimaPercent = '10';
  assert.match(lancaCodigo(() => validarPolitica(abaixo), 'POLITICA_INVALIDA').message, /abaixo da mínima geral/);
  const valor = structuredClone(VALIDA);
  valor.alcadas.gerente.valorMaximoProposta = '10000';
  assert.match(lancaCodigo(() => validarPolitica(valor), 'POLITICA_INVALIDA').message, /Valor máximo do Vendedor/);
  assert.match(lancaCodigo(() => validarPolitica({ margemMinimaPercent: '150' }), 'POLITICA_INVALIDA').message, /entre 0 e 100/);
});

test('política: para ativar exige margem mínima, impostos e ao menos uma alçada', () => {
  const e = lancaCodigo(() => validarPolitica({ configurado: true }), 'POLITICA_INVALIDA');
  assert.equal(e.detalhes.length, 3);
  assert.equal(validarPolitica({ configurado: false }).configurado, false, 'salvar desligada é permitido');
});

test('política salva vale na hora para as alçadas e fica no histórico', () => {
  const b = baseVazia();
  assert.equal(b.politica().configurado, false);
  salvarPolitica(b, VALIDA, { hoje: '2026-10-30' });
  const p = b.politica();
  assert.equal(p.configurado, true);
  assert.equal(p.definidaPor, 'humano');
  assert.equal(p.alcadas.gerente.descontoMaxPercent, 7);
  const h = b.listar('historico').find((x) => x.entidade === 'politica');
  assert.equal(h.antes.configurado, false);
  assert.equal(h.depois.configurado, true);

  const demo = baseDemo();
  const nova = structuredClone(VALIDA);
  nova.alcadas.diretor.descontoMaxPercent = '5'; // PRO-0002 tem 6,56% de desconto
  nova.alcadas.vendedor.descontoMaxPercent = '2';
  nova.alcadas.gerente.descontoMaxPercent = '4';
  salvarPolitica(demo, nova);
  assert.equal(C.avaliar(demo, 'diretor', 'PRO-0002', '2026-10-30').alcadaNecessaria, 'ceo', 'alçada recalculada com a política nova');
});

test('CLI: só o humano define a política', async () => {
  const b = baseDemo();
  const r = await cli(b.dir, ['politica', 'definir', '--agente', 'diretor', '--json', JSON.stringify(VALIDA)]);
  assert.match(r.saida, /PERMISSAO_NEGADA/);
  const ok = await cli(b.dir, ['politica', 'definir', '--agente', 'humano', '--json', JSON.stringify(VALIDA)]);
  assert.equal(ok.codigo, 0, ok.saida);
});

function req(porta, caminho, { metodo = 'GET', corpo } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: { Authorization: 'Bearer token-de-teste-1234567890', 'X-Painel': '1', 'Content-Type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (x) => (d += x));
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(d); } catch { return null; } })(), corpo: d }));
    });
    r.on('error', reject);
    if (corpo) r.write(JSON.stringify(corpo));
    r.end();
  });
}

async function servidor({ base = 'demo', env = {}, erpCliente = null } = {}) {
  const dir = base === 'demo' ? baseDemo().dir : path.join(tmp(), 'producao');
  const cfg = { ...carregar({ HC_MODO: 'simulado', HC_BASE: base }), dataDir: dir, base };
  const o = new Orquestrador({ cfg, eventos: new Eventos({}), executarJob: async () => ({}) });
  const srv = criarServidor({ orquestrador: o, eventos: new Eventos({}), token: 'token-de-teste-1234567890', env, erpCliente });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, porta: srv.address().port, o };
}

test('painel: configuração não expõe segredos; política inválida volta com o motivo; válida é salva', async () => {
  const { srv, porta } = await servidor({ env: { ERP_API_URL: 'https://erp.exemplo.invalid/api/v1', ERP_USUARIO: 'agentes', ERP_SENHA: 'senha-super-secreta' } });
  try {
    const c = await req(porta, '/api/config');
    assert.equal(c.status, 200);
    assert.equal(c.json.base, 'demo');
    assert.equal(c.json.erp.configurado, true);
    assert.equal(c.json.erp.host, 'erp.exemplo.invalid');
    assert.equal(c.json.erp.permitido, false, 'demo não importa do ERP');
    assert.ok(!c.corpo.includes('senha-super-secreta'));
    assert.equal(c.json.saude.ok, true);
    assert.ok(c.json.agentes.length >= 7);

    const ruim = structuredClone(VALIDA);
    ruim.alcadas.vendedor.descontoMaxPercent = '50';
    const r1 = await req(porta, '/api/politica', { metodo: 'POST', corpo: { politica: ruim } });
    assert.equal(r1.status, 422);
    assert.match(r1.json.erro, /Desconto máximo do Vendedor/);
    const r2 = await req(porta, '/api/politica', { metodo: 'POST', corpo: { politica: VALIDA } });
    assert.equal(r2.status, 200);
    assert.equal((await req(porta, '/api/config')).json.politica.alcadas.gerente.descontoMaxPercent, 7);

    const imp = await req(porta, '/api/erp/importar', { metodo: 'POST', corpo: { recurso: 'clientes' } });
    assert.equal(imp.status, 422);
    assert.match(imp.json.erro, /base de produção/);
  } finally {
    srv.close();
  }
});

test('painel: cadastro da equipe e importação do ERP na base de produção', async () => {
  const respostas = {
    '/clientes': [{ id: 7, nome: 'Hospital Real Teste', cnpjCpf: '11222333000181', segmento: 'Hospitalar', clienteNovo: false }],
    '/crm/leads': [{ id: 3, nome: 'Fulano', empresa: 'Clínica Teste', etapa: 'novo', valorEstimado: null, atualizadoEm: '2026-10-20T10:00:00Z' }],
  };
  const { srv, porta, o } = await servidor({ base: 'producao', erpCliente: { get: async (c) => respostas[c] } });
  try {
    const semNome = await req(porta, '/api/agentes', { metodo: 'POST', corpo: { nome: '', papel: 'vendedor', tipo: 'humano' } });
    assert.equal(semNome.status, 422);
    const v = await req(porta, '/api/agentes', { metodo: 'POST', corpo: { nome: 'Ana Souza', papel: 'vendedor', tipo: 'humano', email: 'ana@hcqualitycorp.com.br' } });
    assert.equal(v.status, 200);
    assert.equal(v.json.ficticio, false);
    const dup = await req(porta, '/api/agentes/ativo', { metodo: 'POST', corpo: { id: v.json.id, ativo: false } });
    assert.equal(dup.json.ativo, false);
    await req(porta, '/api/agentes/ativo', { metodo: 'POST', corpo: { id: v.json.id, ativo: true } });

    const cli1 = await req(porta, '/api/erp/importar', { metodo: 'POST', corpo: { recurso: 'clientes' } });
    assert.equal(cli1.status, 200);
    assert.equal(cli1.json.criados, 1);
    const leadsSemResp = await req(porta, '/api/erp/importar', { metodo: 'POST', corpo: { recurso: 'leads' } });
    assert.equal(leadsSemResp.status, 422);
    assert.match(leadsSemResp.json.erro, /responsavel/);
    const leads = await req(porta, '/api/erp/importar', { metodo: 'POST', corpo: { recurso: 'leads', responsavel: v.json.id } });
    assert.equal(leads.json.criados, 2, 'lead + oportunidade');
    const base = o.abrirBase();
    assert.equal(base.listar('oportunidade')[0].responsavelId, v.json.id);
    assert.deepEqual(base.auditar(), []);
  } finally {
    srv.close();
  }

  const semErp = await servidor({ base: 'producao' });
  try {
    const r = await req(semErp.porta, '/api/erp/importar', { metodo: 'POST', corpo: { recurso: 'clientes' } });
    assert.equal(r.status, 422);
    assert.match(r.json.erro, /ERP_API_URL/);
  } finally {
    semErp.srv.close();
  }
});
