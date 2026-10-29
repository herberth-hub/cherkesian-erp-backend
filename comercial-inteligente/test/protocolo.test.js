'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/hierarquia');
const PR = require('../src/protocolo');
const { HOJE, baseDemo, lancaCodigo } = require('./_util');

const sol = (base, agente, para, fluxo, extra = {}) =>
  PR.criarSolicitacao(base, { agente, para, fluxo, objetivo: 'Objetivo de teste', prazo: '2026-11-05', resultadoEsperado: 'Resultado', ...extra }, HOJE);

test('cadeia de comando: CEO > Diretor > Gerente > Vendedor, com humano no topo', () => {
  assert.deepEqual(H.cadeiaEscalonamento('vendedor'), ['vendedor', 'gerente', 'diretor', 'ceo', 'humano']);
  assert.equal(H.subordinado('ceo'), 'diretor');
  assert.equal(H.subordinado('diretor'), 'gerente');
  assert.equal(H.subordinado('gerente'), 'vendedor');
  assert.equal(H.subordinado('vendedor'), null);
  assert.ok(H.acimaDe('ceo', 'diretor') && H.acimaDe('diretor', 'gerente') && H.acimaDe('gerente', 'vendedor'));
});

test('delegação só ao subordinado direto; escalonamento só ao superior direto', () => {
  const b = baseDemo();
  lancaCodigo(() => sol(b, 'ceo', 'gerente', 'delegacao'), 'HIERARQUIA_DELEGACAO');
  lancaCodigo(() => sol(b, 'vendedor', 'diretor', 'escalonamento'), 'HIERARQUIA_ESCALONAMENTO');
  lancaCodigo(() => sol(b, 'gerente', 'diretor', 'delegacao'), 'HIERARQUIA_DELEGACAO');
  lancaCodigo(() => sol(b, 'diretor', 'gerente', 'escalonamento'), 'HIERARQUIA_ESCALONAMENTO');
  assert.equal(sol(b, 'ceo', 'diretor', 'delegacao').responsavel, 'diretor');
  assert.equal(sol(b, 'vendedor', 'gerente', 'escalonamento').responsavel, 'gerente');
});

test('solicitação exige objetivo, prazo futuro e resultado esperado', () => {
  const b = baseDemo();
  lancaCodigo(() => sol(b, 'ceo', 'diretor', 'delegacao', { objetivo: '' }), 'CAMPO_OBRIGATORIO');
  lancaCodigo(() => sol(b, 'ceo', 'diretor', 'delegacao', { prazo: undefined }), 'CAMPO_OBRIGATORIO');
  lancaCodigo(() => sol(b, 'ceo', 'diretor', 'delegacao', { prazo: '2026-10-01' }), 'PRAZO_INVALIDO');
  lancaCodigo(() => sol(b, 'ceo', 'diretor', 'delegacao', { resultadoEsperado: ' ' }), 'CAMPO_OBRIGATORIO');
});

test('escalonamento sobe nível a nível até o humano e a decisão volta para a origem', () => {
  const b = baseDemo();
  const s1 = sol(b, 'vendedor', 'gerente', 'escalonamento', { referencia: 'oportunidade:OPO-0001' });
  const s2 = PR.responderSolicitacao(b, { agente: 'gerente', id: s1.id, tipo: 'escalonamento', texto: 'Fora da minha alçada' }, HOJE);
  assert.equal(s2.responsavel, 'diretor');
  assert.equal(b.obter('solicitacao', s1.id).status, 'aguardando_aprovacao');
  const s3 = PR.responderSolicitacao(b, { agente: 'diretor', id: s2.id, tipo: 'escalonamento', texto: 'Estratégico' }, HOJE);
  const s4 = PR.responderSolicitacao(b, { agente: 'ceo', id: s3.id, tipo: 'escalonamento', texto: 'Margem abaixo da mínima' }, HOJE);
  assert.equal(s4.responsavel, 'humano');
  lancaCodigo(() => PR.responderSolicitacao(b, { agente: 'humano', id: s4.id, tipo: 'escalonamento', texto: 'x' }, HOJE), 'HIERARQUIA_ESCALONAMENTO');
  PR.responderSolicitacao(b, { agente: 'humano', id: s4.id, tipo: 'decisao', texto: 'Aprovado com condição' }, HOJE);
  assert.equal(b.obter('solicitacao', s4.id).status, 'concluida');
  assert.equal(b.obter('solicitacao', s3.id).status, 'em_andamento');
  assert.ok(b.obter('solicitacao', s3.id).respostas.some((r) => r.texto.includes('Aprovado com condição')));
});

test('sem ciclos: o que chegou por escalonamento não pode ser delegado de volta', () => {
  const b = baseDemo();
  const s1 = sol(b, 'gerente', 'diretor', 'escalonamento');
  lancaCodigo(() => sol(b, 'diretor', 'gerente', 'delegacao', { origemId: s1.id }), 'CICLO_PROIBIDO');
});

test('sem ciclos: um escalonamento aberto por vez e só o responsável desdobra', () => {
  const b = baseDemo();
  const d = sol(b, 'ceo', 'diretor', 'delegacao');
  lancaCodigo(() => sol(b, 'gerente', 'vendedor', 'delegacao', { origemId: d.id }), 'NAO_RESPONSAVEL');
  sol(b, 'diretor', 'ceo', 'escalonamento', { origemId: d.id });
  lancaCodigo(() => sol(b, 'diretor', 'ceo', 'escalonamento', { origemId: d.id }), 'ESCALONAMENTO_ABERTO');
});

test('sem ciclos: profundidade máxima é respeitada', () => {
  const b = baseDemo();
  let atual = sol(b, 'ceo', 'diretor', 'delegacao');
  // força profundidade no limite para provar a trava
  b.atualizar('solicitacao', atual.id, { profundidade: H.PROFUNDIDADE_MAXIMA }, 'sistema');
  atual = b.obter('solicitacao', atual.id);
  lancaCodigo(() => sol(b, 'diretor', 'gerente', 'delegacao', { origemId: atual.id }), 'PROFUNDIDADE_EXCEDIDA');
});

test('propriedade: toda cadeia gerada pelas regras termina no humano em no máximo 4 escalonamentos', () => {
  for (const inicio of ['vendedor', 'gerente', 'diretor', 'ceo']) {
    const b = baseDemo();
    let s = sol(b, inicio, H.superior(inicio), 'escalonamento');
    let passos = 1;
    while (s.responsavel !== 'humano') {
      s = PR.responderSolicitacao(b, { agente: s.responsavel, id: s.id, tipo: 'escalonamento', texto: 'sobe' }, HOJE);
      passos++;
      assert.ok(passos <= 4, 'cadeia não pode exceder 4 escalonamentos');
    }
  }
});

test('pedido de informação e complemento pelo solicitante', () => {
  const b = baseDemo();
  const s = sol(b, 'gerente', 'vendedor', 'delegacao');
  const r = PR.responderSolicitacao(b, { agente: 'vendedor', id: s.id, tipo: 'pedido_informacao', texto: 'Falta a grade', informacoesFaltantes: ['grade'] }, HOJE);
  assert.equal(r.status, 'aguardando_informacao');
  assert.deepEqual(r.informacoesFaltantes, ['grade']);
  lancaCodigo(() => PR.responderSolicitacao(b, { agente: 'vendedor', id: s.id, tipo: 'informacao', texto: 'x' }, HOJE), 'NAO_RESPONSAVEL');
  assert.equal(PR.responderSolicitacao(b, { agente: 'gerente', id: s.id, tipo: 'informacao', texto: 'Grade P-GG' }, HOJE).status, 'em_andamento');
});

test('trabalho delegado só é concluído após verificação do solicitante', () => {
  const b = baseDemo();
  const s = sol(b, 'diretor', 'gerente', 'delegacao');
  const r = PR.responderSolicitacao(b, { agente: 'gerente', id: s.id, tipo: 'conclusao', texto: 'Metas desdobradas: MET-0002' }, HOJE);
  assert.equal(r.status, 'aguardando_aprovacao');
  lancaCodigo(() => PR.verificarSolicitacao(b, { agente: 'gerente', id: s.id, aceitar: true, texto: 'ok' }), 'NAO_RESPONSAVEL');
  lancaCodigo(() => PR.verificarSolicitacao(b, { agente: 'diretor', id: s.id, aceitar: true, texto: '' }), 'CAMPO_OBRIGATORIO');
  assert.equal(PR.verificarSolicitacao(b, { agente: 'diretor', id: s.id, aceitar: true, texto: 'Conferido MET-0002' }).status, 'concluida');
});

test('tarefa: conclusão exige evidência e verificação de quem atribuiu', () => {
  const b = baseDemo();
  const t = PR.criarTarefa(b, { agente: 'gerente', responsavel: 'vendedor', titulo: 'Follow-up OPO-0002', prazo: '2026-10-31', condicaoConclusao: 'Atividade registrada' });
  lancaCodigo(() => PR.criarTarefa(b, { agente: 'gerente', responsavel: 'ceo', titulo: 'x', prazo: '2026-10-31', condicaoConclusao: 'y' }), 'HIERARQUIA_DELEGACAO');
  PR.moverTarefa(b, { agente: 'vendedor', id: t.id, status: 'em_andamento' });
  lancaCodigo(() => PR.moverTarefa(b, { agente: 'vendedor', id: t.id, status: 'concluida', evidencia: 'ATV-0005' }), 'VERIFICACAO_OBRIGATORIA');
  lancaCodigo(() => PR.moverTarefa(b, { agente: 'vendedor', id: t.id, status: 'aguardando_aprovacao' }), 'CAMPO_OBRIGATORIO');
  PR.moverTarefa(b, { agente: 'vendedor', id: t.id, status: 'aguardando_aprovacao', evidencia: 'ATV-0005' });
  lancaCodigo(() => PR.moverTarefa(b, { agente: 'gerente', id: t.id, status: 'concluida' }), 'CAMPO_OBRIGATORIO');
  const fim = PR.moverTarefa(b, { agente: 'gerente', id: t.id, status: 'concluida', evidencia: 'ATV-0005 conferida' });
  assert.equal(fim.verificacao.verificadoPor, 'gerente');
  lancaCodigo(() => PR.moverTarefa(b, { agente: 'gerente', id: t.id, status: 'em_andamento' }), 'TRANSICAO_INVALIDA');
});

test('os seis status de tarefa estão disponíveis', () => {
  assert.deepEqual(Object.keys(PR.TRANSICOES).sort(), ['aguardando_aprovacao', 'aguardando_informacao', 'bloqueada', 'concluida', 'em_andamento', 'pendente']);
});
