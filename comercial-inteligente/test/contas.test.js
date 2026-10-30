'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/comercial');
const K = require('../src/contas');
const { visaoBase } = require('../servico/servidor');
const { baseVazia, cli } = require('./_util');

// Dados FICTÍCIOS de teste (CNPJs com raiz inventada).
const RAIZ = '11222333';
const CNPJ_MATRIZ = `${RAIZ}000181`;
const CNPJ_FILIAL = `${RAIZ}000262`;
const CNPJ_FILIAL2 = `${RAIZ}000343`;

function montar() {
  const b = baseVazia();
  const vend = b.criar('agente', { nome: 'Vendedora A', papel: 'vendedor', tipo: 'humano', ativo: true }, 'humano');
  const vend2 = b.criar('agente', { nome: 'Vendedor B', papel: 'vendedor', tipo: 'humano', ativo: true }, 'humano');
  const g = C.registrar(b, 'hunter', 'grupo', {
    nome: 'Grupo Exemplo',
    controladora: 'Exemplo Participações',
    segmentos: ['industria'],
    colaboradoresGrupo: { valor: 40000, evidencia: 'comprovado', fonte: 'relatório anual', dataPesquisa: '2026-10-30' },
    colaboradoresBrasil: { valor: 6000, evidencia: 'estimado', fonte: 'notícias + vagas', dataPesquisa: '2026-10-30' },
    modeloCompra: 'hibrida',
    categoriasCentralizadas: ['epi'],
  });
  const emp = C.registrar(b, 'hunter', 'empresa', { grupoId: g.id, razaoSocial: 'Exemplo Indústria SA', cnpjMatriz: CNPJ_MATRIZ, papelNoGrupo: 'controladora', colaboradoresBrasil: { valor: 6000, evidencia: 'estimado' } });
  const matriz = C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'Sede São Paulo', tipo: 'matriz', cidade: 'São Paulo', uf: 'SP', cnpj: CNPJ_MATRIZ, funcionariosLocais: { valor: 300, evidencia: 'estimado' } });
  const fab = C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'Fábrica Barueri', tipo: 'fabrica', cidade: 'Barueri', uf: 'SP', cnpj: CNPJ_FILIAL, funcionariosLocais: { valor: 1000, evidencia: 'estimado' } });
  const cd = C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'CD Cajamar', tipo: 'centro_distribuicao', cidade: 'Cajamar', uf: 'SP', funcionariosLocais: { valor: 400, evidencia: 'estimado' } });
  return { b, g, emp, matriz, fab, cd, vend, vend2 };
}

test('[1] matriz e filiais pelo CNPJ: ordem 0001 é matriz; tipo incoerente é recusado', () => {
  const { b, g } = montar();
  assert.equal(K.classificarCnpj(CNPJ_MATRIZ).estabelecimento, 'matriz');
  assert.equal(K.classificarCnpj(CNPJ_FILIAL).estabelecimento, 'filial');
  assert.throws(() => C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'X', tipo: 'matriz', cidade: 'Osasco', cnpj: CNPJ_FILIAL2 }), /MATRIZ_FILIAL|filial/);
  assert.throws(() => C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'Y', tipo: 'filial', cidade: 'Osasco', cnpj: `99888777000199` }), /matriz/);
});

test('[2] vínculo entre empresas do mesmo grupo: raiz do CNPJ liga a unidade à empresa; outro grupo é recusado', () => {
  const { b, g, emp, fab } = montar();
  assert.equal(fab.empresaId, emp.id, 'empresa completada pela raiz do CNPJ');
  const outro = C.registrar(b, 'hunter', 'grupo', { nome: 'Outro Grupo', modeloCompra: 'descentralizada' });
  assert.throws(() => C.registrar(b, 'hunter', 'unidade', { grupoId: outro.id, nome: 'Z', tipo: 'filial', cidade: 'Guarulhos', cnpj: CNPJ_FILIAL2 }), /GRUPO_DIVERGENTE|pertence/);
  const arv = K.arvoreGrupo(b, g.id);
  assert.equal(arv.empresas[0].unidades.length, 2, 'matriz e fábrica sob a empresa');
  assert.equal(arv.unidadesSemEmpresa.length, 1, 'CD sem CNPJ fica sem empresa até ser identificado');
});

test('[3] funcionários por abrangência: unidade não recebe o total do grupo/Brasil e nada é somado', () => {
  const { b, g, cd } = montar();
  assert.throws(() => C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'Unidade Osasco', tipo: 'base_operacional', cidade: 'Osasco', funcionariosLocais: { valor: 6000, evidencia: 'estimado' } }), /ABRANGENCIA_FUNCIONARIOS|LOCAIS/);
  assert.throws(() => C.atualizar(b, 'hunter', 'unidade', cd.id, { funcionariosLocais: { valor: 40000, evidencia: 'comprovado' } }), /LOCAIS/);
  const arv = K.arvoreGrupo(b, g.id);
  assert.equal(arv.funcionarios.grupo.valor, 40000);
  assert.equal(arv.funcionarios.brasil.valor, 6000);
  assert.equal(arv.funcionarios.unidadesComDadoLocal, 3);
  assert.ok(!('total' in arv.funcionarios), 'nenhum total somando abrangências');
  assert.equal(K.elegibilidade(g).status, 'elegivel_estimado', 'Brasil (estimado) decide o porte');
  assert.equal(K.elegibilidade({ colaboradoresBrasil: { valor: 800, evidencia: 'comprovado' } }).status, 'abaixo_do_porte');
});

test('[4][7] compra híbrida: EPI entra pelo canal corporativo uma vez só; potencial é estimativa', () => {
  const { b, g, fab } = montar();
  const p = K.potencialUnidade(b, fab);
  assert.equal(p.estimativa, true);
  assert.equal(p.categorias.industrial.pessoas, 800, '80% de 1.000 na fábrica (premissa)');
  assert.equal(p.valorAno, null, 'sem ticket médio, valor em R$ não calculável');
  const c1 = K.consolidadoGrupo(b, g.id);
  assert.deepEqual(c1.categoriasCentrais, ['epi']);
  const epiUnidades = c1.porUnidade.reduce((s, u) => s + u.categorias.epi.pecasAno, 0);
  assert.equal(c1.corporativo.pecasAno, epiUnidades, 'sem potencial corporativo informado, usa a soma das unidades em EPI');
  assert.equal(c1.total.pecasAno, c1.porUnidade.reduce((s, u) => s + u.pecasAno, 0), 'total = soma por canal, sem duplicar');
  // Com potencial corporativo informado, o EPI das unidades NÃO é somado de novo.
  C.atualizar(b, 'gerente', 'grupo', g.id, { potencialCorporativo: { pecasAno: 5000, valorAno: null, premissa: 'contrato corporativo de EPI estimado pelo comprador' } });
  const c2 = K.consolidadoGrupo(b, g.id);
  assert.equal(c2.corporativo.pecasAno, 5000);
  assert.equal(c2.total.pecasAno, 5000 + c2.local.pecasAno);
  assert.ok(!c2.local.categorias.includes('epi'));
});

test('[5] compradores corporativos e locais: "evidenciada" exige evidência; local exige unidade', () => {
  const { b, g, fab } = montar();
  assert.throws(() => C.registrar(b, 'hunter', 'comprador', { grupoId: g.id, nivel: 'corporativo', nome: 'Fulana', cargo: 'Diretora de Suprimentos', confirmacao: 'evidenciada' }), /evidenciaFuncao/);
  const corp = C.registrar(b, 'hunter', 'comprador', { grupoId: g.id, nivel: 'corporativo', nome: 'Fulana', cargo: 'Diretora de Suprimentos', funcao: 'diretor_suprimentos', confirmacao: 'evidenciada', evidenciaFuncao: 'Entrevista cita que ela conduz a homologação de fornecedores de EPI' });
  assert.throws(() => C.registrar(b, 'hunter', 'comprador', { grupoId: g.id, nivel: 'local', nome: 'Beltrano', confirmacao: 'presumida_pelo_cargo' }), /unidadeId/);
  C.registrar(b, 'hunter', 'comprador', { grupoId: g.id, unidadeId: fab.id, nivel: 'local', nome: 'Beltrano', cargo: 'Técnico de Segurança', funcao: 'seguranca_trabalho', confirmacao: 'presumida_pelo_cargo' });
  const t = K.painelContas(b).totais;
  assert.equal(t.compradoresCorporativos, 1);
  assert.equal(t.compradoresLocais, 1);
  assert.deepEqual(t.compradoresEvidenciados, { corporativos: 1, locais: 0 });
  assert.equal(corp.nivel, 'corporativo');
});

test('[6] prevenção de duplicidade: grupo, empresa (raiz do CNPJ), unidade (CNPJ ou nome+cidade) e comprador', () => {
  const { b, g } = montar();
  assert.throws(() => C.registrar(b, 'hunter', 'grupo', { nome: 'GRUPO EXEMPLO', modeloCompra: 'desconhecido' }), /Já existe/);
  assert.throws(() => C.registrar(b, 'hunter', 'empresa', { grupoId: g.id, razaoSocial: 'Outra razão', cnpjMatriz: `${RAIZ}000181`, papelNoGrupo: 'subsidiaria' }), /Já existe/);
  assert.throws(() => C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'fabrica barueri', tipo: 'fabrica', cidade: 'BARUERI' }), /Já existe/);
  assert.throws(() => C.registrar(b, 'hunter', 'unidade', { grupoId: g.id, nome: 'Planta 2', tipo: 'filial', cidade: 'Barueri', cnpj: CNPJ_FILIAL }), /Já existe/);
});

test('[8] distribuição: só o gerente distribui; abordagem paralela na mesma conta é bloqueada', () => {
  const { b, g, fab, cd, vend, vend2 } = montar();
  assert.throws(() => K.atribuir(b, 'vendedor', { grupoId: g.id, responsavelId: vend.id }), /gerente comercial/);
  assert.throws(() => C.atualizar(b, 'hunter', 'unidade', fab.id, { responsavelId: vend.id }), /gerente comercial/);
  K.atribuir(b, 'gerente', { grupoId: g.id, responsavelId: vend.id });
  K.atribuir(b, 'gerente', { grupoId: g.id, responsavelId: vend.id, papel: 'corporativo' });
  K.atribuir(b, 'gerente', { unidadeId: cd.id, responsavelId: vend2.id });
  assert.equal(b.obter('unidade', cd.id).responsavelId, vend2.id);
  const lead = C.registrar(b, 'vendedor', 'lead', { empresa: 'Exemplo Indústria SA', segmento: 'industria', fonte: 'hunter', status: 'qualificado' });
  const base = { leadId: lead.id, etapa: 'contato_realizado', valorEstimado: null, ultimoContatoEm: '2026-10-30', proximoPasso: 'Reunião', proximoPassoEm: '2026-11-05' };
  const corp = C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Homologação corporativa EPI', responsavelId: vend.id, grupoId: g.id });
  assert.equal(corp.canal, 'corporativo');
  assert.throws(() => C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Outra corporativa', responsavelId: vend2.id, grupoId: g.id }), /negociação/);
  const local = C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Uniformes CD', responsavelId: vend2.id, unidadeId: cd.id });
  assert.equal(local.grupoId, g.id, 'grupo completado pela unidade');
  assert.throws(() => C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Uniformes CD 2', responsavelId: vend.id, unidadeId: cd.id }), /negociação/);
  const v = K.verificarAbordagem(b, { unidadeId: fab.id });
  assert.equal(v.corporativas.length, 1);
  assert.equal(v.outrasUnidades.length, 1);
  assert.match(v.orientacao, /corporativa/);
  // Compra centralizada: oportunidade local de outro vendedor é bloqueada enquanto há negociação corporativa.
  C.atualizar(b, 'gerente', 'grupo', g.id, { modeloCompra: 'centralizada' });
  assert.throws(() => C.registrar(b, 'vendedor', 'oportunidade', { ...base, titulo: 'Uniformes fábrica', responsavelId: vend2.id, unidadeId: fab.id }), /centralizada/);
  // Histórico: atribuições ficam registradas.
  assert.ok(b.listar('historico').some((h) => h.entidade === 'unidade' && h.registroId === cd.id && h.acao === 'atribuir'));
});

test('[9] integração: painel de grandes contas, Grande SP, CLI e permissões do hunter', async () => {
  const { b, g } = montar();
  const p = K.painelContas(b);
  assert.equal(p.totais.grupos, 1);
  assert.equal(p.totais.unidades, 3);
  assert.equal(p.totais.unidadesGrandeSP, 3, 'São Paulo, Barueri e Cajamar são Grande SP');
  assert.equal(K.naGrandeSP('Campinas'), false);
  assert.equal(p.totais.unidadesNaoExploradas, 3);
  assert.ok(p.cidades.find((c) => c.cidade === 'Barueri'));
  assert.ok(visaoBase(b).funil, 'dashboards existentes continuam funcionando com grandes contas');
  const arv = await cli(b.dir, ['conta', 'arvore', '--grupo', g.id, '--agente', 'gerente'], { base: 'producao' });
  assert.equal(arv.codigo, 0, arv.saida);
  assert.equal(arv.json.grupo.id, g.id);
  const neg = await cli(b.dir, ['registrar', 'proposta', '--agente', 'hunter', '--json', '{}'], { base: 'producao' });
  assert.notEqual(neg.codigo, 0, 'hunter não monta proposta');
  const atr = await cli(b.dir, ['conta', 'atribuir', '--grupo', g.id, '--responsavel', 'AGT-0001', '--agente', 'vendedor'], { base: 'producao' });
  assert.notEqual(atr.codigo, 0, 'vendedor não distribui contas');
});
