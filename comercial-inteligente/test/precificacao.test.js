'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularMargem, determinarAlcada, avaliarProposta, custoUnitario } = require('../src/precificacao');

const POLITICA = {
  configurado: true,
  margemMinimaPercent: 18,
  premissasPadrao: { impostosPercent: 9.25, comissaoPercent: 3 },
  alcadas: {
    vendedor: { descontoMaxPercent: 3, margemMinimaPercent: 35, valorMaximoProposta: 20000 },
    gerente: { descontoMaxPercent: 7, margemMinimaPercent: 30, valorMaximoProposta: 60000 },
    diretor: { descontoMaxPercent: 12, margemMinimaPercent: 25, valorMaximoProposta: 200000 },
    ceo: { descontoMaxPercent: 18, margemMinimaPercent: 20, valorMaximoProposta: null },
  },
};

test('margem de contribuição verificável (exemplo documentado em knowledge/precificacao.md)', () => {
  const m = calcularMargem({ precoUnitario: 50, quantidade: 100, custoVariavelUnitario: 20, impostosPercent: 10, comissaoPercent: 5, freteTotal: 100, outrosCustosVariaveis: 0 });
  assert.equal(m.status, 'calculada');
  assert.equal(m.receitaBruta, 5000);
  assert.equal(m.impostos, 500);
  assert.equal(m.receitaLiquida, 4500);
  assert.equal(m.custosVariaveis, 2350);
  assert.equal(m.margemContribuicao, 2150);
  assert.equal(m.percentual, 47.78);
  assert.equal(m.memoria.length, 6);
});

test('margem não é confundida com markup', () => {
  const m = calcularMargem({ precoUnitario: 50, quantidade: 100, custoVariavelUnitario: 20, impostosPercent: 10, comissaoPercent: 5, freteTotal: 100, outrosCustosVariaveis: 0 });
  assert.equal(m.markupMultiplicador, 2.5);
  assert.notEqual(m.percentual, 60, 'a conta ingênua (preço-custo)/preço daria 60%');
  assert.notEqual(m.percentual, 150, 'markup percentual sobre custo daria 150%');
});

test('custo ou impostos ausentes → margem não calculável, sem número', () => {
  const semCusto = calcularMargem({ precoUnitario: 50, quantidade: 10, custoVariavelUnitario: null, impostosPercent: 10 });
  assert.equal(semCusto.status, 'nao_calculavel');
  assert.equal(semCusto.percentual, null);
  assert.ok(semCusto.faltantes.includes('custoVariavelUnitario'));
  const semImposto = calcularMargem({ precoUnitario: 50, quantidade: 10, custoVariavelUnitario: 20 });
  assert.equal(semImposto.status, 'nao_calculavel');
  assert.ok(semImposto.faltantes.includes('impostosPercent'));
});

test('comissão/frete ausentes → margem provisória com premissas declaradas', () => {
  const m = calcularMargem({ precoUnitario: 50, quantidade: 10, custoVariavelUnitario: 20, impostosPercent: 10 });
  assert.equal(m.status, 'provisoria');
  assert.equal(m.premissas.length, 3);
  assert.ok(m.premissas.every((p) => p.includes('assumido 0')));
});

test('componentes de custo incompletos tornam o custo provisório', () => {
  const c = custoUnitario({}, { componentesCusto: { tecido: 10, aviamentos: 2, bordado: null } });
  assert.equal(c.valor, 12);
  assert.equal(c.provisorio, true);
  assert.deepEqual(c.faltantes, ['bordado']);
});

test('política não configurada → toda decisão vai ao humano', () => {
  const r = determinarAlcada({ margem: { status: 'calculada', percentual: 50 }, descontoPercent: 0, valorTotal: 100, politica: { configurado: false } });
  assert.equal(r.alcada, 'humano');
});

test('margem abaixo da mínima nunca é aprovada automaticamente', () => {
  const r = determinarAlcada({ margem: { status: 'calculada', percentual: 15 }, descontoPercent: 0, valorTotal: 100, politica: POLITICA });
  assert.equal(r.alcada, 'humano');
  assert.equal(r.autoAprovavel, false);
});

test('alçada sobe conforme desconto, margem e valor', () => {
  const m = (p) => ({ status: 'calculada', percentual: p });
  assert.equal(determinarAlcada({ margem: m(40), descontoPercent: 2, valorTotal: 10000, politica: POLITICA }).alcada, 'vendedor');
  assert.equal(determinarAlcada({ margem: m(40), descontoPercent: 5, valorTotal: 10000, politica: POLITICA }).alcada, 'gerente');
  assert.equal(determinarAlcada({ margem: m(40), descontoPercent: 5, valorTotal: 80000, politica: POLITICA }).alcada, 'diretor');
  assert.equal(determinarAlcada({ margem: m(22), descontoPercent: 5, valorTotal: 10000, politica: POLITICA }).alcada, 'ceo');
  assert.equal(determinarAlcada({ margem: m(40), descontoPercent: 25, valorTotal: 10000, politica: POLITICA }).alcada, 'humano');
});

test('margem não calculável, item sem tabela e cliente estratégico exigem no mínimo diretor', () => {
  assert.equal(determinarAlcada({ margem: { status: 'nao_calculavel', percentual: null }, politica: POLITICA }).alcada, 'diretor');
  assert.equal(determinarAlcada({ margem: { status: 'calculada', percentual: 40 }, politica: POLITICA, semPrecoAutorizado: ['x'] }).alcada, 'diretor');
  assert.equal(determinarAlcada({ margem: { status: 'calculada', percentual: 40 }, politica: POLITICA, estrategica: true }).alcada, 'diretor');
  assert.equal(determinarAlcada({ margem: { status: 'provisoria', percentual: 40 }, politica: POLITICA }).alcada, 'gerente');
});

test('avaliação de proposta agrega itens, desconto e pendências', () => {
  const produtosPorId = { 'PRD-0001': { precoAutorizado: 100, custoVariavelUnitario: 40 } };
  const av = avaliarProposta(
    { id: 'PRO-0001', itens: [{ produtoId: 'PRD-0001', descricao: 'X', quantidade: 10, precoUnitario: 95 }], premissasCusto: { impostosPercent: 10, comissaoPercent: 0, freteTotal: 0, outrosCustosVariaveis: 0 }, prazoEntrega: { confirmadoOperacao: false } },
    { produtosPorId, politica: POLITICA, hoje: '2026-10-29' },
  );
  assert.equal(av.valorTotal, 950);
  assert.equal(av.descontoPercent, 5);
  assert.equal(av.margem.status, 'calculada');
  // RL = 855; CV = 400; MC = 455; 53,22%
  assert.equal(av.margem.percentual, 53.22);
  assert.equal(av.alcadaNecessaria, 'gerente');
  assert.ok(av.pendencias.some((p) => p.includes('NÃO confirmado')));
  assert.ok(av.pendencias.some((p) => p.includes('Validade')));
  assert.ok(av.pendencias.some((p) => p.includes('justificativa')));
});
