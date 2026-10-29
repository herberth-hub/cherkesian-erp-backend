'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../integracoes/erp');
const { baseVazia } = require('./_util');

// Formatos espelham os modelos Prisma (prisma/schema.prisma: Cliente, Lead, Pedido, Produto).
const CLIENTE = { id: 7, nome: 'Hospital Teste', fantasia: null, cnpjCpf: '11.222.333/0001-81', cidadeUf: 'São Paulo/SP', segmento: 'Hospitalar', clienteNovo: false };
const LEAD = { id: 3, nome: 'Fulano', empresa: 'Clínica Teste', cnpjCpf: null, origem: 'site', etapa: 'proposta', valorEstimado: '12000.00', proximaAcao: 'Retornar', proximaAcaoEm: '2026-11-02T00:00:00.000Z', atualizadoEm: '2026-10-20T10:00:00.000Z', qtdColaboradores: 50, trocasUniforme: 3, frequenciaCompra: 'anual', perdaMotivo: null };
const PEDIDO = { id: 9, numero: 'PV09', clienteId: 7, data: '2026-10-01T00:00:00.000Z', prazoEntrega: '2026-11-10T00:00:00.000Z', valorTotal: '5000.00', etapa: 'producao' };
const PRODUTO = { id: 4, codigo: 'PRD-JAL-0001', categoria: 'Jaleco', descricao: 'Jaleco gabardine', precoBase: '89.90', custo: '35.00' };

test('mapeamentos do ERP preservam valores e não inventam dados', () => {
  const c = E.mapearCliente(CLIENTE);
  assert.equal(c.cnpj, '11222333000181');
  assert.equal(c.segmento, 'saude');
  assert.equal(c.status, 'ativo');
  const o = E.mapearOportunidade(LEAD, { leadId: 'LEA-0001', responsavelId: 'AGT-0001' });
  assert.equal(o.etapa, 'proposta_enviada');
  assert.equal(o.valorEstimado, 12000);
  assert.equal(o.qualificacao.quantidadePecas, 150);
  assert.equal(o.ultimoContatoEm, '2026-10-20');
  const p = E.mapearPedido(PEDIDO, { clienteId: 'CLI-0001' });
  assert.equal(p.status, 'em_producao');
  assert.equal(p.valorTotal, 5000);
  assert.match(p.evidencia, /PV09/);
  assert.equal(E.mapearPedido({ ...PEDIDO, etapa: 'orcamento' }, { clienteId: 'CLI-0001' }), null, 'orçamento não vira pedido');
  const pr = E.mapearProduto(PRODUTO);
  assert.equal(pr.precoAutorizado, 89.9);
  assert.equal(pr.custoVariavelUnitario, 35);
  assert.equal(pr.categoria, 'jaleco');
  assert.deepEqual(pr.certificacoes, [], 'certificação nunca é presumida');
  assert.equal(E.mapearProduto({ ...PRODUTO, precoBase: null }).precoAutorizado, null);
});

test('importação com cliente HTTP simulado: cria, depois atualiza sem duplicar', async () => {
  const b = baseVazia();
  b.criar('agente', { nome: 'Vendedor real', papel: 'vendedor', tipo: 'humano', ativo: true }, 'humano');
  const respostas = { '/clientes': [CLIENTE], '/pedidos': [PEDIDO, { ...PEDIDO, id: 10, numero: 'PV10', etapa: 'orcamento' }], '/produtos': [PRODUTO], '/crm/leads': [LEAD] };
  const cliente = { get: async (c) => respostas[c] };
  assert.equal((await E.importar(b, 'clientes', { cliente })).criados, 1);
  const peds = await E.importar(b, 'pedidos', { cliente });
  assert.equal(peds.criados, 1);
  assert.equal(peds.ignorados, 1);
  await E.importar(b, 'produtos', { cliente });
  const leads = await E.importar(b, 'leads', { cliente, responsavelPadraoId: 'AGT-0001' });
  assert.equal(leads.criados, 2, 'lead + oportunidade');
  const de_novo = await E.importar(b, 'clientes', { cliente });
  assert.equal(de_novo.criados, 0);
  assert.equal(de_novo.atualizados, 1);
  assert.equal(b.listar('cliente').length, 1);
  assert.deepEqual(b.auditar(), []);
  assert.ok(b.listar('pedido').every((p) => p.origem === 'erp' && p.ficticio === false));
});

test('cliente HTTP exige variáveis de ambiente', () => {
  assert.throws(() => new E.ErpLeitura({ url: '', usuario: '', senha: '' }), /ERP_API_URL, ERP_USUARIO, ERP_SENHA/);
});

test('cliente HTTP faz login e envia o token (fetch simulado), sem métodos de escrita', async () => {
  const chamadas = [];
  const fetchImpl = async (url, op = {}) => {
    chamadas.push({ url, metodo: op.method || 'GET', auth: (op.headers || {}).Authorization });
    if (url.endsWith('/auth/login')) return { ok: true, json: async () => ({ accessToken: 'tok' }) };
    return { ok: true, json: async () => [] };
  };
  const erp = new E.ErpLeitura({ url: 'https://erp.invalid/api/v1', usuario: 'u', senha: 's', fetchImpl });
  await erp.get('/clientes');
  assert.deepEqual(chamadas.map((c) => c.metodo), ['POST', 'GET']);
  assert.equal(chamadas[1].auth, 'Bearer tok');
  assert.equal(typeof erp.post, 'undefined');
});
