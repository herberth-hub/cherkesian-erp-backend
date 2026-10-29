'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../src/comercial');
const A = require('../src/analises');
const R = require('../src/relatorios');
const { ocultar, ocultarArgs } = require('../src/log');
const { HOJE, baseDemo, baseVazia, lancaCodigo, cli } = require('./_util');

test('semente de demonstração é válida e 100% fictícia', () => {
  const b = baseDemo();
  assert.deepEqual(b.auditar(), []);
  for (const ent of ['cliente', 'oportunidade', 'pedido', 'produto', 'agente']) {
    assert.ok(b.listar(ent).length > 0);
    assert.ok(b.listar(ent).every((r) => r.ficticio === true), `${ent} deve ser fictício`);
  }
  assert.ok(b.listar('cliente').every((c) => /FICT[ÍI]CI[OA]/.test(c.razaoSocial)), 'nome de cliente demo identifica a ficção');
  assert.ok(b.listar('cliente').every((c) => c.cnpj === null), 'demo não usa CNPJ que possa existir');
});

test('base de produção recusa registro fictício e a demo recusa registro real', () => {
  const prod = baseVazia();
  lancaCodigo(() => prod.criar('agente', { nome: 'X', papel: 'vendedor', tipo: 'humano', ativo: true, ficticio: true }, 'humano'), 'VALIDACAO');
  const demo = baseDemo();
  lancaCodigo(() => demo.criar('agente', { nome: 'Y', papel: 'vendedor', tipo: 'humano', ativo: true, ficticio: false }, 'humano'), 'VALIDACAO');
});

test('campos obrigatórios ausentes são identificados pela validação', () => {
  const b = baseDemo();
  const e = lancaCodigo(() => C.registrar(b, 'vendedor', 'oportunidade', { titulo: 'Sem dados', clienteId: 'CLI-0001', responsavelId: 'AGT-0005', etapa: 'contato_realizado' }), 'VALIDACAO');
  for (const campo of ['valorEstimado', 'ultimoContatoEm', 'proximoPasso', 'proximoPassoEm']) assert.match(e.message, new RegExp(campo));
});

test('referência inexistente é recusada', () => {
  const b = baseDemo();
  const e = lancaCodigo(
    () => C.registrar(b, 'vendedor', 'atividade', { oportunidadeId: 'OPO-9999', responsavelId: 'AGT-0005', tipo: 'nota', data: HOJE, resumo: 'x' }),
    'VALIDACAO',
  );
  assert.match(e.message, /OPO-9999 não existe/);
});

test('não duplica cliente (nome normalizado), lead nem oportunidade aberta', () => {
  const b = baseDemo();
  const e = lancaCodigo(() => C.registrar(b, 'vendedor', 'cliente', { razaoSocial: 'HOSPITAL DEMONSTRAÇÃO ALFA', segmento: 'saude', status: 'prospect' }), 'DUPLICADO');
  assert.equal(e.detalhes.existente, 'CLI-0001');
  lancaCodigo(() => C.registrar(b, 'vendedor', 'lead', { empresa: 'Prefeitura Demo Eta', segmento: 'publico', fonte: 'x', status: 'novo' }), 'DUPLICADO');
  lancaCodigo(
    () =>
      C.registrar(b, 'vendedor', 'oportunidade', {
        titulo: 'Reposição anual de privativos - Hospital Alfa',
        clienteId: 'CLI-0001',
        responsavelId: 'AGT-0005',
        etapa: 'contato_realizado',
        valorEstimado: null,
        ultimoContatoEm: null,
        proximoPasso: null,
        proximoPassoEm: null,
      }),
    'DUPLICADO',
  );
});

test('toda escrita gera histórico com antes/depois', () => {
  const b = baseDemo();
  C.atualizar(b, 'vendedor', 'oportunidade', 'OPO-0003', { proximoPasso: 'Ligar para compras', proximoPassoEm: '2026-10-30' });
  const h = b.listar('historico').filter((x) => x.registroId === 'OPO-0003').pop();
  assert.equal(h.acao, 'atualizar');
  assert.equal(h.agente, 'vendedor');
  assert.equal(h.antes.proximoPasso, null);
  assert.equal(h.depois.proximoPasso, 'Ligar para compras');
});

test('campos de controle não são alteráveis', () => {
  const b = baseDemo();
  lancaCodigo(() => b.atualizar('cliente', 'CLI-0001', { ficticio: false }, 'humano'), 'CAMPO_PROTEGIDO');
});

test('arquivo corrompido gera erro claro (tratamento de erro)', () => {
  const b = baseDemo();
  fs.writeFileSync(path.join(b.dir, 'clientes.json'), '{quebrado');
  b.cache = {};
  lancaCodigo(() => b.listar('cliente'), 'ARQUIVO_CORROMPIDO');
});

test('segredos são ocultados em logs', () => {
  assert.deepEqual(ocultar({ senha: '123', token: 'abc', nome: 'ok', aninhado: { apiKey: 'k' } }), { senha: '***', token: '***', nome: 'ok', aninhado: { apiKey: '***' } });
  assert.equal(ocultar('Authorization Bearer abc.def.ghi'), 'Authorization ***');
  assert.deepEqual(ocultarArgs(['--senha', 'x', '--token=y', '--nome', 'z']), ['--senha', '***', '--token=***', '--nome', 'z']);
});

test('log de execução registra sucesso e erro sem segredos', async () => {
  const b = baseDemo();
  await cli(b.dir, ['listar', 'cliente', '--agente', 'gerente', '--token', 'segredo123']);
  await cli(b.dir, ['obter', 'cliente', '--id', 'CLI-9999', '--agente', 'gerente']);
  const linhas = fs.readFileSync(path.join(b.dir, 'logs', 'execucao.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(linhas[0].ok, true);
  assert.equal(linhas[1].ok, false);
  assert.equal(linhas[1].erro, 'NAO_ENCONTRADO');
  assert.ok(!JSON.stringify(linhas).includes('segredo123'));
});

test('análises identificam dados ausentes, follow-up, parados, duplicidades e inativos', () => {
  const b = baseDemo();
  const pr = b.premissas();
  const aus = A.dadosAusentes(b);
  const o3 = aus.find((x) => x.id === 'OPO-0003');
  assert.ok(o3.faltando.includes('valorEstimado') && o3.faltando.includes('qualificacao.personalizacao') && o3.faltando.includes('qualificacao.localEntrega'));
  const sem = A.semFollowUp(b, { hoje: HOJE });
  assert.ok(sem.find((x) => x.id === 'OPO-0002').motivos[0].includes('vencido'));
  assert.ok(sem.find((x) => x.id === 'OPO-0003').motivos.includes('sem próximo passo'));
  const par = A.parados(b, { hoje: HOJE, diasLimite: pr.diasSemContatoParaAlerta });
  assert.deepEqual(par.map((p) => p.id).sort(), ['OPO-0002', 'OPO-0007']);
  const ina = A.clientesInativos(b, { hoje: HOJE, diasLimite: pr.diasInatividadeCliente });
  assert.deepEqual(ina.map((c) => c.id).sort(), ['CLI-0002', 'CLI-0005']);
  assert.deepEqual(A.duplicidades(b), []);
  const risco = A.pedidosEmRisco(b, { hoje: HOJE, diasAlerta: pr.diasAlertaPrazoPedido });
  assert.deepEqual(risco.map((p) => p.id).sort(), ['PED-0001', 'PED-0006']);
});

test('previsão separa carteira confirmada de pipeline estimado e lista o que ficou de fora', () => {
  const b = baseDemo();
  const p = A.previsao(b, { hoje: HOJE, premissas: b.premissas() });
  assert.equal(p.janelas[0].carteiraConfirmada, 30400);
  assert.equal(p.janelas[0].pipelinePonderado, 60420); // 89.900×60% + 16.200×40%
  assert.deepEqual(p.foraDaPrevisao.map((x) => x.id).sort(), ['OPO-0003', 'OPO-0007']);
  assert.deepEqual(p.pedidosSemPrazo, ['PED-0006']);
});

test('relatórios têm as seis seções obrigatórias na ordem, nos quatro níveis', () => {
  const b = baseDemo();
  for (const tipo of ['vendedor', 'gerente', 'diretor', 'ceo']) {
    const md = R.gerar(tipo, b, { hoje: HOJE, responsavelId: 'AGT-0005' }).markdown();
    const posicoes = R.SECOES.map(([, rotulo]) => md.indexOf(`## ${rotulo}`));
    assert.ok(posicoes.every((p) => p > 0), `${tipo}: todas as seções presentes`);
    assert.deepEqual([...posicoes].sort((x, y) => x - y), posicoes, `${tipo}: seções em ordem`);
    assert.match(md, /DADOS SÃO FICTÍCIOS/);
    assert.ok(/R\$\s*[1-9]/.test(md), `${tipo}: com dados, há valores (sanidade da verificação inversa)`);
  }
});

test('sem dados, relatório mostra a estrutura sem fabricar resultados', () => {
  const b = baseVazia();
  for (const tipo of ['gerente', 'diretor', 'ceo']) {
    const md = R.gerar(tipo, b, { hoje: HOJE }).markdown();
    assert.match(md, /Política comercial: \*\*NÃO CONFIGURADA\*\*/);
    assert.doesNotMatch(md, /FICTÍCIOS/);
    assert.ok(!/R\$\s*[1-9]/.test(md), `${tipo}: nenhum valor monetário diferente de zero sem dados`);
  }
  const ceo = R.gerar('ceo', b, { hoje: HOJE }).markdown();
  assert.match(ceo, /Inadimplência.*não implementada/);
  assert.match(ceo, /Meta da empresa.*não aprovada/);
});
