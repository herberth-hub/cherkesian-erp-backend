'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/comercial');
const { HOJE, baseDemo, lancaCodigo } = require('./_util');

test('vendedor não inventa preço: item sem preço autorizado é recusado', () => {
  const b = baseDemo();
  lancaCodigo(
    () => C.registrar(b, 'vendedor', 'proposta', { oportunidadeId: 'OPO-0005', itens: [{ produtoId: 'PRD-0004', quantidade: 10, precoUnitario: 99 }] }),
    'PRECO_NAO_AUTORIZADO',
  );
  lancaCodigo(() => C.registrar(b, 'gerente', 'proposta', { oportunidadeId: 'OPO-0005', itens: [{ descricao: 'Peça sem cadastro', quantidade: 10, precoUnitario: 10 }] }), 'PRECO_NAO_AUTORIZADO');
});

test('vendedor usa o preço autorizado quando não informa preço', () => {
  const b = baseDemo();
  const p = C.registrar(b, 'vendedor', 'proposta', { oportunidadeId: 'OPO-0004', itens: [{ produtoId: 'PRD-0003', quantidade: 100 }] });
  assert.equal(p.itens[0].precoUnitario, 54);
  assert.equal(p.status, 'rascunho');
});

test('diretor pode formar preço de item sem tabela, mas a alçada mínima é diretor', () => {
  const b = baseDemo();
  const p = C.registrar(b, 'diretor', 'proposta', { oportunidadeId: 'OPO-0004', itens: [{ produtoId: 'PRD-0004', quantidade: 50, precoUnitario: 120 }], premissasCusto: { impostosPercent: 9.25, comissaoPercent: 3, freteTotal: 0, outrosCustosVariaveis: 0 } });
  const av = C.avaliar(b, 'diretor', p.id, HOJE);
  assert.ok(av.semPrecoAutorizado.length === 1);
  assert.ok(['diretor', 'ceo', 'humano'].includes(av.alcadaNecessaria));
});

test('aprovação respeita alçada: gerente não aprova o que exige diretor', () => {
  const b = baseDemo();
  const { aprovacao, avaliacao, proximoPasso } = C.solicitarAprovacao(b, 'vendedor', 'PRO-0002', HOJE);
  assert.equal(avaliacao.alcadaNecessaria, 'diretor');
  assert.match(proximoPasso, /escale ao superior \("gerente"\)/);
  assert.equal(b.obter('proposta', 'PRO-0002').status, 'aguardando_aprovacao');
  lancaCodigo(() => C.decidirAprovacao(b, 'vendedor', { id: aprovacao.id, decisao: 'aprovada', justificativa: 'x' }, HOJE), 'FORA_DA_ALCADA');
  lancaCodigo(() => C.decidirAprovacao(b, 'gerente', { id: aprovacao.id, decisao: 'aprovada', justificativa: 'x' }, HOJE), 'FORA_DA_ALCADA');
  lancaCodigo(() => C.decidirAprovacao(b, 'diretor', { id: aprovacao.id, decisao: 'aprovada', justificativa: '' }, HOJE), 'CAMPO_OBRIGATORIO');
  C.decidirAprovacao(b, 'diretor', { id: aprovacao.id, decisao: 'aprovada', justificativa: 'Volume anual e cliente estratégico' }, HOJE);
  assert.equal(b.obter('proposta', 'PRO-0002').status, 'aprovada');
  lancaCodigo(() => C.decidirAprovacao(b, 'ceo', { id: aprovacao.id, decisao: 'recusada', justificativa: 'x' }, HOJE), 'APROVACAO_ENCERRADA');
});

test('nenhum agente marca proposta como aprovada ou enviada por edição direta', () => {
  const b = baseDemo();
  lancaCodigo(() => C.atualizar(b, 'ceo', 'proposta', 'PRO-0002', { status: 'aprovada' }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.atualizar(b, 'diretor', 'proposta', 'PRO-0002', { status: 'aprovada' }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.atualizar(b, 'diretor', 'proposta', 'PRO-0002', { status: 'enviada' }), 'PERMISSAO_NEGADA');
});

test('alterar condições de proposta aprovada invalida avaliação e aprovação', () => {
  const b = baseDemo();
  const { aprovacao } = C.solicitarAprovacao(b, 'vendedor', 'PRO-0002', HOJE);
  C.decidirAprovacao(b, 'diretor', { id: aprovacao.id, decisao: 'aprovada', justificativa: 'ok' }, HOJE);
  const p = C.atualizar(b, 'vendedor', 'proposta', 'PRO-0002', { itens: [{ produtoId: 'PRD-0001', quantidade: 1000, precoUnitario: 80 }] });
  assert.equal(p.status, 'rascunho');
  assert.equal(p.avaliacao, null);
});

test('margem abaixo da mínima vai ao humano mesmo para o CEO', () => {
  const b = baseDemo();
  const p = C.registrar(b, 'diretor', 'proposta', { oportunidadeId: 'OPO-0004', itens: [{ produtoId: 'PRD-0003', quantidade: 100, precoUnitario: 30 }], premissasCusto: { impostosPercent: 9.25, comissaoPercent: 3, freteTotal: 0, outrosCustosVariaveis: 0 }, justificativaDesconto: 'teste' });
  const { aprovacao } = C.solicitarAprovacao(b, 'diretor', p.id, HOJE);
  assert.equal(aprovacao.alcadaNecessaria, 'humano');
  lancaCodigo(() => C.decidirAprovacao(b, 'ceo', { id: aprovacao.id, decisao: 'aprovada', justificativa: 'x' }, HOJE), 'FORA_DA_ALCADA');
  assert.equal(C.decidirAprovacao(b, 'humano', { id: aprovacao.id, decisao: 'recusada', justificativa: 'Margem insuficiente' }, HOJE).status, 'recusada');
  assert.equal(b.obter('proposta', p.id).status, 'rascunho');
});

test('metas: CEO propõe, humano aprova, diretor desdobra, ninguém altera meta do superior', () => {
  const b = baseDemo();
  const m = C.definirMeta(b, 'ceo', { nivel: 'empresa', periodo: '2026-11', faturamento: 180000 });
  assert.equal(m.status, 'proposta');
  lancaCodigo(() => C.definirMeta(b, 'diretor', { nivel: 'gerente', periodo: '2026-11', faturamento: 100000, metaPaiId: m.id }), 'META_NAO_APROVADA');
  lancaCodigo(() => C.atualizar(b, 'ceo', 'meta', m.id, { status: 'aprovada' }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.definirMeta(b, 'diretor', { nivel: 'empresa', periodo: '2026-11', faturamento: 1 }), 'PERMISSAO_NEGADA');
  C.atualizar(b, 'humano', 'meta', m.id, { status: 'aprovada' });
  const g = C.definirMeta(b, 'diretor', { nivel: 'gerente', periodo: '2026-11', faturamento: 180000, metaPaiId: m.id });
  lancaCodigo(() => C.atualizar(b, 'diretor', 'meta', m.id, { faturamento: 100000 }), 'HIERARQUIA_META');
  lancaCodigo(() => C.atualizar(b, 'gerente', 'meta', g.id, { faturamento: 1 }), 'HIERARQUIA_META');
  lancaCodigo(() => C.definirMeta(b, 'gerente', { nivel: 'gerente', periodo: '2026-11', faturamento: 1, metaPaiId: g.id }), 'PERMISSAO_NEGADA');
  C.definirMeta(b, 'gerente', { nivel: 'vendedor', periodo: '2026-11', faturamento: 90000, metaPaiId: g.id, responsavelId: 'AGT-0005' });
  const cob = C.coberturaMeta(b, g.id);
  assert.equal(cob.soma, 90000);
  assert.equal(cob.diferenca, 90000);
});

test('permissões: vendedor não cadastra produto, pedido, nem cliente ativo', () => {
  const b = baseDemo();
  lancaCodigo(() => C.registrar(b, 'vendedor', 'produto', { descricao: 'x', categoria: 'outro', precoAutorizado: 10, custoVariavelUnitario: 5 }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.registrar(b, 'ceo', 'pedido', { clienteId: 'CLI-0001', evidencia: 'x', data: HOJE, valorTotal: 1, status: 'recebido' }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.registrar(b, 'vendedor', 'cliente', { razaoSocial: 'Nova Empresa Teste (FICTÍCIA)', segmento: 'outro', status: 'ativo' }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.atualizar(b, 'vendedor', 'cliente', 'CLI-0004', { status: 'ativo' }), 'PERMISSAO_NEGADA');
  lancaCodigo(() => C.atualizar(b, 'vendedor', 'oportunidade', 'OPO-0004', { responsavelId: 'AGT-0005' }), 'PERMISSAO_NEGADA');
  assert.equal(C.atualizar(b, 'gerente', 'oportunidade', 'OPO-0004', { responsavelId: 'AGT-0005' }).responsavelId, 'AGT-0005');
});

test('pedido só com evidência (humano)', () => {
  const b = baseDemo();
  lancaCodigo(() => C.registrar(b, 'humano', 'pedido', { clienteId: 'CLI-0001', data: HOJE, valorTotal: 100, status: 'recebido' }), 'VALIDACAO');
  const p = C.registrar(b, 'humano', 'pedido', { clienteId: 'CLI-0001', evidencia: 'OC fictícia 123', data: HOJE, valorTotal: 100, status: 'recebido' });
  assert.equal(p.criadoPor, 'humano');
});
