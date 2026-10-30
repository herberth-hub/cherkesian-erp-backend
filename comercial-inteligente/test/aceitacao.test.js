'use strict';

/**
 * Testes de aceitação (seção 15 do prompt mestre), executados pela CLI — o mesmo
 * caminho usado pelos agentes. Cada teste cita o critério que cobre.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { baseDemo, cli } = require('./_util');

const ok = (r) => {
  assert.equal(r.codigo, 0, r.saida);
  return r.json;
};
const erro = (r, codigo) => {
  assert.equal(r.codigo, 1, `esperado erro ${codigo}, saída: ${r.saida}`);
  assert.match(r.saida, new RegExp(`ERRO \\[${codigo}\\]`));
};

test('[1][2] quatro agentes distintos e hierarquia aplicada pela CLI', async () => {
  const b = baseDemo();
  const h = ok(await cli(b.dir, ['hierarquia', '--agente', 'ceo']));
  assert.deepEqual(h.map((x) => x.papel), ['humano', 'ceo', 'diretor', 'gerente', 'vendedor']);
  assert.equal(h.find((x) => x.papel === 'vendedor').escalonamento, 'vendedor → gerente → diretor → ceo → humano');
});

test('[3][4][5] fluxo completo de exceção: vendedor → gerente → diretor → CEO → humano', async () => {
  const b = baseDemo();
  const d = b.dir;
  // Vendedor monta proposta a R$ 45 sobre tabela de R$ 54: desconto de 16,67% (diretor vai só até 12%).
  const prop = ok(await cli(d, ['registrar', 'proposta', '--agente', 'vendedor', '--json', JSON.stringify({ oportunidadeId: 'OPO-0004', itens: [{ produtoId: 'PRD-0003', quantidade: 400, precoUnitario: 45 }], premissasCusto: { impostosPercent: 9.25, comissaoPercent: 3, freteTotal: 300, outrosCustosVariaveis: 0 }, condicoesPagamento: '28 dias', validadeAte: '2026-11-15', justificativaDesconto: 'Volume de contrato recorrente' })]));
  const sol = ok(await cli(d, ['aprovacao', 'solicitar', '--proposta', prop.id, '--agente', 'vendedor']));
  // desconto 16,67% → só cabe na alçada do CEO (até 18%); margem 37,31%
  assert.equal(sol.avaliacao.alcadaNecessaria, 'ceo');
  const apr = sol.aprovacao.id;

  // [3] vendedor encaminha ao gerente (não pode pular para o diretor)
  erro(await cli(d, ['solicitacao', 'criar', '--agente', 'vendedor', '--para', 'diretor', '--fluxo', 'escalonamento', '--objetivo', 'x', '--prazo', '2026-10-31', '--resultado-esperado', 'y']), 'HIERARQUIA_ESCALONAMENTO');
  const s1 = ok(await cli(d, ['solicitacao', 'criar', '--agente', 'vendedor', '--para', 'gerente', '--fluxo', 'escalonamento', '--objetivo', `Aprovar ${prop.id}`, '--prazo', '2026-10-31', '--resultado-esperado', 'Decisão de aprovação', '--ref', `aprovacao:${apr}`]));
  erro(await cli(d, ['aprovacao', 'decidir', '--id', apr, '--decisao', 'aprovada', '--justificativa', 'x', '--agente', 'gerente']), 'FORA_DA_ALCADA');
  // [4] gerente escala ao diretor
  const s2 = ok(await cli(d, ['solicitacao', 'responder', '--id', s1.id, '--tipo', 'escalonamento', '--texto', 'Desconto acima da minha alçada', '--agente', 'gerente']));
  assert.equal(s2.responsavel, 'diretor');
  erro(await cli(d, ['aprovacao', 'decidir', '--id', apr, '--decisao', 'aprovada', '--justificativa', 'x', '--agente', 'diretor']), 'FORA_DA_ALCADA');
  // [5] diretor escala ao CEO, que decide
  const s3 = ok(await cli(d, ['solicitacao', 'responder', '--id', s2.id, '--tipo', 'escalonamento', '--texto', 'Desconto de 16,7% exige CEO', '--agente', 'diretor']));
  assert.equal(s3.responsavel, 'ceo');
  ok(await cli(d, ['aprovacao', 'decidir', '--id', apr, '--decisao', 'aprovada', '--justificativa', 'Contrato recorrente com margem acima de 30%', '--agente', 'ceo']));
  ok(await cli(d, ['solicitacao', 'responder', '--id', s3.id, '--tipo', 'decisao', '--texto', `Aprovada ${apr}`, '--agente', 'ceo']));
  assert.equal(b.listar('solicitacao').find((s) => s.id === s2.id).status, 'em_andamento');
  b.cache = {};
  assert.equal(b.obter('proposta', prop.id).status, 'aprovada');
  // o envio ao cliente continua sendo do humano
  erro(await cli(d, ['atualizar', 'proposta', '--id', prop.id, '--json', '{"status":"enviada"}', '--agente', 'ceo']), 'PERMISSAO_NEGADA');
});

test('[6] nenhum agente inventa preço ou dado de cliente', async () => {
  const b = baseDemo();
  erro(await cli(b.dir, ['registrar', 'proposta', '--agente', 'vendedor', '--json', JSON.stringify({ oportunidadeId: 'OPO-0005', itens: [{ produtoId: 'PRD-0004', quantidade: 10, precoUnitario: 80 }] })]), 'PRECO_NAO_AUTORIZADO');
  erro(await cli(b.dir, ['registrar', 'produto', '--agente', 'diretor', '--json', JSON.stringify({ descricao: 'x', categoria: 'outro', precoAutorizado: 1, custoVariavelUnitario: 1 })]), 'PERMISSAO_NEGADA');
  erro(await cli(b.dir, ['registrar', 'pedido', '--agente', 'ceo', '--json', JSON.stringify({ clienteId: 'CLI-0001', evidencia: 'x', data: '2026-10-29', valorTotal: 1, status: 'recebido' })]), 'PERMISSAO_NEGADA');
  // dado ausente fica explícito (null), não é preenchido
  const op = ok(await cli(b.dir, ['registrar', 'oportunidade', '--agente', 'vendedor', '--json', JSON.stringify({ titulo: 'Aventais para cozinha industrial', clienteId: 'CLI-0003', responsavelId: 'AGT-0004', etapa: 'contato_realizado', valorEstimado: null, ultimoContatoEm: '2026-10-29', proximoPasso: 'Levantar quantidade', proximoPassoEm: '2026-11-03' })]));
  const aus = ok(await cli(b.dir, ['pipeline', 'dados-ausentes', '--agente', 'gerente']));
  assert.ok(aus.find((x) => x.id === op.id).faltando.includes('valorEstimado'));
});

test('[7] relatórios distinguem dados reais de estimativas', async () => {
  const b = baseDemo();
  const r = await cli(b.dir, ['relatorio', 'diretor', '--agente', 'diretor']);
  assert.equal(r.codigo, 0);
  const confirmados = r.saida.split('## 2. Estimativas')[0];
  const estimativas = r.saida.split('## 2. Estimativas')[1].split('## 3. Premissas')[0];
  assert.match(confirmados, /Faturamento confirmado/);
  assert.doesNotMatch(confirmados, /Pipeline ponderado/);
  assert.match(estimativas, /Pipeline ponderado \(estimativa\)/);
  const j = ok(await cli(b.dir, ['relatorio', 'ceo', '--agente', 'ceo', '--formato', 'json']));
  assert.deepEqual(Object.keys(j.secoes), ['confirmados', 'estimativas', 'premissas', 'ausentes', 'recomendacoes', 'decisoes']);
  assert.equal(j.ficticio, true);
});

test('[8] cálculo de margem verificável pela CLI, com memória de cálculo', async () => {
  const b = baseDemo();
  const r = ok(await cli(b.dir, ['margem', '--preco', '50', '--qtd', '100', '--custo', '20', '--impostos', '10', '--comissao', '5', '--frete', '100', '--outros', '0', '--preco-tabela', '50', '--agente', 'diretor']));
  assert.equal(r.margem.percentual, 47.78);
  assert.ok(r.margem.memoria.some((l) => l.includes('MC% = 2150 ÷ 4500 × 100 = 47.78%')));
  const parcial = ok(await cli(b.dir, ['margem', '--preco', '50', '--qtd', '100', '--impostos', '10', '--agente', 'diretor']));
  assert.equal(parcial.margem.status, 'nao_calculavel');
});

test('[9] sistema identifica informações obrigatórias ausentes', async () => {
  const b = baseDemo();
  erro(await cli(b.dir, ['registrar', 'oportunidade', '--agente', 'vendedor', '--json', JSON.stringify({ titulo: 'Incompleta', clienteId: 'CLI-0003', responsavelId: 'AGT-0004', etapa: 'contato_realizado' })]), 'VALIDACAO');
  erro(await cli(b.dir, ['solicitacao', 'criar', '--agente', 'ceo', '--para', 'diretor', '--fluxo', 'delegacao', '--objetivo', 'x', '--resultado-esperado', 'y']), 'CAMPO_OBRIGATORIO');
  erro(await cli(b.dir, ['relatorio', 'vendedor', '--agente', 'vendedor']), 'ARGUMENTO_AUSENTE');
  const av = ok(await cli(b.dir, ['proposta', 'avaliar', '--id', 'PRO-0002', '--agente', 'gerente']));
  assert.ok(av.pendencias.some((p) => p.includes('Prazo de entrega NÃO confirmado')));
});

test('[10] permissões impedem ações não autorizadas', async () => {
  const b = baseDemo();
  erro(await cli(b.dir, ['erp', 'importar', '--recurso', 'clientes', '--agente', 'ceo']), 'PERMISSAO_NEGADA');
  erro(await cli(b.dir, ['demo', 'restaurar', '--agente', 'diretor']), 'PERMISSAO_NEGADA');
  erro(await cli(b.dir, ['meta', 'definir', '--nivel', 'empresa', '--periodo', '2026-11', '--faturamento', '1', '--agente', 'diretor']), 'PERMISSAO_NEGADA');
  erro(await cli(b.dir, ['atualizar', 'meta', '--id', 'MET-0001', '--json', '{"faturamento":1}', '--agente', 'ceo']), 'HIERARQUIA_META');
  erro(await cli(b.dir, ['tarefa', 'criar', '--responsavel', 'diretor', '--titulo', 'x', '--prazo', '2026-11-01', '--condicao', 'y', '--agente', 'vendedor']), 'HIERARQUIA_DELEGACAO');
});

test('[11] delegação não gera ciclos', async () => {
  const b = baseDemo();
  const s = ok(await cli(b.dir, ['solicitacao', 'criar', '--agente', 'gerente', '--para', 'diretor', '--fluxo', 'escalonamento', '--objetivo', 'Prazo de 10 dias', '--prazo', '2026-11-01', '--resultado-esperado', 'Decisão']));
  erro(await cli(b.dir, ['solicitacao', 'criar', '--agente', 'diretor', '--para', 'gerente', '--fluxo', 'delegacao', '--origem', s.id, '--objetivo', 'Devolver', '--prazo', '2026-11-01', '--resultado-esperado', 'x']), 'CICLO_PROIBIDO');
});

test('[13] fluxo de meta: CEO propõe → humano aprova → diretor desdobra → gerente desdobra e conclui → diretor verifica', async () => {
  const b = baseDemo();
  const d = b.dir;
  const m = ok(await cli(d, ['meta', 'definir', '--nivel', 'empresa', '--periodo', '2026-11', '--faturamento', '170000', '--agente', 'ceo']));
  assert.equal(m.status, 'proposta');
  ok(await cli(d, ['atualizar', 'meta', '--id', m.id, '--json', '{"status":"aprovada"}', '--agente', 'humano']));
  const mg = ok(await cli(d, ['meta', 'definir', '--nivel', 'gerente', '--periodo', '2026-11', '--faturamento', '170000', '--meta-pai', m.id, '--responsavel-id', 'AGT-0003', '--agente', 'diretor']));
  const del = ok(await cli(d, ['solicitacao', 'criar', '--agente', 'diretor', '--para', 'gerente', '--fluxo', 'delegacao', '--objetivo', `Desdobrar ${mg.id} por vendedor`, '--prazo', '2026-11-02', '--resultado-esperado', 'Metas por vendedor somando a meta do gerente', '--ref', `meta:${mg.id}`]));
  ok(await cli(d, ['meta', 'definir', '--nivel', 'vendedor', '--periodo', '2026-11', '--faturamento', '100000', '--meta-pai', mg.id, '--responsavel-id', 'AGT-0005', '--agente', 'gerente']));
  ok(await cli(d, ['meta', 'definir', '--nivel', 'vendedor', '--periodo', '2026-11', '--faturamento', '70000', '--meta-pai', mg.id, '--responsavel-id', 'AGT-0006', '--agente', 'gerente']));
  const cob = ok(await cli(d, ['meta', 'cobertura', '--id', mg.id, '--agente', 'gerente']));
  assert.equal(cob.diferenca, 0);
  ok(await cli(d, ['solicitacao', 'responder', '--id', del.id, '--tipo', 'conclusao', '--texto', 'Metas criadas; cobertura 100%', '--agente', 'gerente']));
  const fim = ok(await cli(d, ['solicitacao', 'verificar', '--id', del.id, '--aceitar', '--texto', 'meta cobertura com diferença 0', '--agente', 'diretor']));
  assert.equal(fim.status, 'concluida');
});

test('base de produção vazia: comandos funcionam e relatório não fabrica resultados', async () => {
  const dir = require('path').join(require('./_util').tmp(), 'producao');
  const r = await cli(dir, ['relatorio', 'ceo', '--agente', 'ceo'], { base: 'producao' });
  assert.equal(r.codigo, 0);
  assert.match(r.saida, /Faturamento confirmado no mês:\*\* R\$\s0,00 \(0 pedido\(s\)\)/);
  assert.match(r.saida, /NÃO CONFIGURADA/);
  const p = ok(await cli(dir, ['politica', 'mostrar', '--agente', 'ceo'], { base: 'producao' }));
  assert.equal(p.configurado, false);
  assert.equal(p.margemMinimaPercent, null);
});
