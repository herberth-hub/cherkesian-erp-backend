'use strict';

/**
 * Inteligência de grandes contas (Enterprise Account Intelligence).
 *
 * Estrutura: GRUPO ECONÔMICO → EMPRESAS (controladora, subsidiárias) → UNIDADES (matriz, filiais,
 * fábricas, CDs...) e COMPRADORES (corporativos e locais). Regras que este módulo garante:
 *  - colaboradores do grupo, da empresa no Brasil e de cada unidade nunca se misturam nem se somam;
 *  - matriz × filial conferida pelo CNPJ (ordem 0001 = matriz) e vínculo da unidade à empresa pela raiz do CNPJ;
 *  - potencial por unidade é ESTIMATIVA com premissas explícitas, nunca pedido;
 *  - categorias compradas centralmente entram uma vez só no consolidado (corporativo OU unidades, nunca os dois);
 *  - antes de abordar uma unidade, a CLI mostra (e bloqueia) negociação corporativa ou local já em andamento.
 */

const fs = require('fs');
const path = require('path');
const { ErroNegocio } = require('./erros');
const P = require('./permissoes');
const H = require('./hierarquia');
const { normalizar, soDigitos, RAIZ } = require('./store');
const { CATEGORIAS_POTENCIAL, CIDADES_GRANDE_SP, ETAPAS_ABERTAS } = require('./dominio');

const PORTE_MINIMO = 1000;
const CIDADES_GSP = new Set(CIDADES_GRANDE_SP.map((c) => normalizar(c)));

/** Cidade da Grande São Paulo (região metropolitana)? */
const naGrandeSP = (cidade) => CIDADES_GSP.has(normalizar(cidade));

/** Premissas de consumo (estimativas): arquivo da base, se o humano definiu, ou o modelo do repositório. */
function premissasContas(base) {
  const local = path.join(base.dir, 'premissas_contas.json');
  const f = fs.existsSync(local) ? local : path.join(RAIZ, 'config', 'premissas_contas.json');
  return { ...JSON.parse(fs.readFileSync(f, 'utf8')), _arquivo: path.relative(RAIZ, f) };
}

// ------------------------------------------------------------------ CNPJ: matriz × filial

/** Ordem do estabelecimento no CNPJ (dígitos 9 a 12): 0001 é a matriz. */
function classificarCnpj(cnpj) {
  const c = soDigitos(cnpj);
  if (c.length !== 14) return null;
  return { raiz: c.slice(0, 8), ordem: c.slice(8, 12), estabelecimento: c.slice(8, 12) === '0001' ? 'matriz' : 'filial' };
}

/** Confere coerência de uma unidade com o grupo, a empresa e o CNPJ. Pode completar empresaId. Lança em conflito. */
function conferirUnidade(base, dados) {
  const grupo = base.exigir('grupo', dados.grupoId);
  const out = { ...dados };
  const cls = classificarCnpj(dados.cnpj);
  if (cls) {
    if (dados.tipo === 'matriz' && cls.estabelecimento !== 'matriz') {
      throw new ErroNegocio('MATRIZ_FILIAL', `CNPJ ${dados.cnpj} é de filial (ordem ${cls.ordem}); a matriz tem ordem 0001. Corrija o tipo ou o CNPJ.`);
    }
    if (dados.tipo === 'filial' && cls.estabelecimento === 'matriz') {
      throw new ErroNegocio('MATRIZ_FILIAL', `CNPJ ${dados.cnpj} é de matriz (ordem 0001), não de filial.`);
    }
    // A raiz do CNPJ identifica a empresa: a unidade pertence a ela (e ao grupo dela).
    const dona = base.listar('empresa').find((e) => classificarCnpj(e.cnpjMatriz) && classificarCnpj(e.cnpjMatriz).raiz === cls.raiz);
    if (dona) {
      if (dona.grupoId !== grupo.id) {
        throw new ErroNegocio('GRUPO_DIVERGENTE', `CNPJ ${dados.cnpj} pertence a ${dona.id} (${dona.razaoSocial}), do grupo ${dona.grupoId}, não de ${grupo.id}.`);
      }
      if (out.empresaId && out.empresaId !== dona.id) {
        throw new ErroNegocio('EMPRESA_DIVERGENTE', `A raiz do CNPJ ${dados.cnpj} é de ${dona.id} (${dona.razaoSocial}), não de ${out.empresaId}.`);
      }
      out.empresaId = dona.id;
    }
  }
  if (out.empresaId) {
    const emp = base.exigir('empresa', out.empresaId);
    if (emp.grupoId !== grupo.id) throw new ErroNegocio('GRUPO_DIVERGENTE', `Empresa ${emp.id} é do grupo ${emp.grupoId}, não de ${grupo.id}.`);
  }
  conferirFuncionarios(base, out, grupo);
  return out;
}

/**
 * Funcionários por abrangência: a unidade nunca recebe o total do grupo ou da empresa.
 * Um número local igual ou maior que o total do grupo/Brasil é tratado como erro de abrangência.
 */
function conferirFuncionarios(base, unidade, grupo) {
  const local = unidade.funcionariosLocais && unidade.funcionariosLocais.valor;
  if (local == null) return;
  const totais = [
    ['do grupo', grupo.colaboradoresGrupo],
    ['do grupo no Brasil', grupo.colaboradoresBrasil],
    ...(unidade.empresaId ? [['da empresa no Brasil', base.exigir('empresa', unidade.empresaId).colaboradoresBrasil]] : []),
  ];
  const outras = base.listar('unidade').filter((u) => u.grupoId === grupo.id && u.id !== unidade.id).length;
  for (const [rotulo, m] of totais) {
    if (!m || m.valor == null) continue;
    if (local > m.valor || (local === m.valor && outras > 0)) {
      throw new ErroNegocio(
        'ABRANGENCIA_FUNCIONARIOS',
        `A unidade "${unidade.nome}" recebeu ${local} funcionários, o mesmo ou mais que o total ${rotulo} (${m.valor}). ` +
          'Registre só os funcionários LOCAIS da instalação (ou deixe null se não houver dado local).',
      );
    }
  }
}

/** Grupo elegível como conta principal: ≥ 1.000 colaboradores, conforme a qualidade da evidência. */
function elegibilidade(grupo) {
  const m = [grupo.colaboradoresBrasil, grupo.colaboradoresGrupo].find((x) => x && x.valor != null);
  if (!m) return { status: 'sem_dado', texto: 'Sem número de colaboradores: pesquise antes de priorizar.' };
  if (m.valor < PORTE_MINIMO) return { status: 'abaixo_do_porte', texto: `${m.valor} colaboradores (${m.evidencia}): abaixo de ${PORTE_MINIMO}.` };
  if (m.evidencia === 'comprovado') return { status: 'elegivel', texto: `${m.valor} colaboradores comprovados.` };
  if (m.evidencia === 'estimado') return { status: 'elegivel_estimado', texto: `${m.valor} colaboradores (estimativa): elegível, confirmar a evidência.` };
  return { status: 'pendente_evidencia', texto: `${m.valor} colaboradores sem fonte verificada: confirmar antes de priorizar.` };
}

// ------------------------------------------------------------------ potencial (estimativa)

/** Potencial anual estimado de uma unidade por categoria. Sem funcionários locais: não calculável. */
function potencialUnidade(base, u, premissas = premissasContas(base)) {
  const func = u.funcionariosLocais && u.funcionariosLocais.valor;
  const resultado = { unidadeId: u.id, estimativa: true, categorias: {}, pecasAno: 0, valorAno: null, faltando: [], premissas: premissas._arquivo };
  if (func == null) {
    resultado.calculavel = false;
    resultado.faltando.push('funcionários locais');
    return resultado;
  }
  const perfil = u.perfilMaoDeObra && Object.values(u.perfilMaoDeObra).some((v) => v != null) ? u.perfilMaoDeObra : premissas.perfilPorTipo[u.tipo] || premissas.perfilPorTipo.outra;
  const perfilPremissa = !(u.perfilMaoDeObra && Object.values(u.perfilMaoDeObra).some((v) => v != null));
  if (perfilPremissa) resultado.faltando.push('perfil de mão de obra (usada a premissa do tipo de unidade)');
  let valor = 0;
  let valorCalculavel = true;
  for (const cat of CATEGORIAS_POTENCIAL) {
    const pessoas = cat === 'epi' ? (u.usaEpi === false ? 0 : Math.round(func * ((premissas.epiPorTipo[u.tipo] ?? premissas.epiPorTipo.outra) / 100))) : Math.round(func * ((perfil[cat] || 0) / 100));
    const pecas = Math.round(pessoas * (premissas.pecasPorPessoaAno[cat] || 0));
    const preco = premissas.ticketMedio[cat];
    const v = preco == null ? null : Math.round(pecas * preco * 100) / 100;
    if (pecas && v == null) valorCalculavel = false;
    if (v != null) valor += v;
    resultado.categorias[cat] = { pessoas, pecasAno: pecas, valorAno: v };
    resultado.pecasAno += pecas;
  }
  resultado.calculavel = true;
  resultado.valorAno = valorCalculavel ? Math.round(valor * 100) / 100 : null;
  if (!valorCalculavel) resultado.faltando.push('ticket médio por categoria (valor em R$ não calculável)');
  resultado.reposicaoPeriodica = u.reposicaoPeriodica;
  return resultado;
}

/** Categorias compradas centralmente pelo grupo (centralizada = todas; híbrida = as indicadas). */
function categoriasCentrais(grupo) {
  if (grupo.modeloCompra === 'centralizada') return [...CATEGORIAS_POTENCIAL];
  if (grupo.modeloCompra === 'hibrida') return grupo.categoriasCentralizadas || [];
  return [];
}

/**
 * Consolidado do grupo SEM dupla contagem: cada categoria entra por um canal só.
 *  - categorias centrais: potencial corporativo informado (se houver) OU a soma das unidades nessas categorias;
 *  - categorias locais: soma das unidades.
 */
function consolidadoGrupo(base, grupoId, premissas = premissasContas(base)) {
  const g = base.exigir('grupo', grupoId);
  const unidades = base.listar('unidade').filter((u) => u.grupoId === g.id);
  const centrais = categoriasCentrais(g);
  const porUnidade = unidades.map((u) => ({ unidade: u, potencial: potencialUnidade(base, u, premissas) }));
  const somar = (cats) =>
    porUnidade.reduce(
      (acc, { potencial }) => {
        for (const c of cats) {
          const x = potencial.categorias[c];
          if (!x) continue;
          acc.pecasAno += x.pecasAno;
          if (x.valorAno == null) acc.valorIncompleto = acc.valorIncompleto || x.pecasAno > 0;
          else acc.valorAno += x.valorAno;
        }
        return acc;
      },
      { pecasAno: 0, valorAno: 0, valorIncompleto: false },
    );
  const locais = CATEGORIAS_POTENCIAL.filter((c) => !centrais.includes(c));
  const local = somar(locais);
  let corporativo;
  if (centrais.length && g.potencialCorporativo && (g.potencialCorporativo.pecasAno != null || g.potencialCorporativo.valorAno != null)) {
    corporativo = { fonte: 'potencial corporativo informado', pecasAno: g.potencialCorporativo.pecasAno || 0, valorAno: g.potencialCorporativo.valorAno, valorIncompleto: g.potencialCorporativo.valorAno == null, premissa: g.potencialCorporativo.premissa };
  } else {
    corporativo = { fonte: centrais.length ? 'soma das unidades nas categorias compradas centralmente' : 'sem compra central', ...somar(centrais) };
  }
  const fmt = (x) => ({ pecasAno: x.pecasAno, valorAno: x.valorIncompleto ? null : Math.round((x.valorAno || 0) * 100) / 100 });
  const semCalculo = porUnidade.filter((x) => !x.potencial.calculavel).map((x) => x.unidade.id);
  return {
    grupoId: g.id,
    estimativa: true,
    modeloCompra: g.modeloCompra,
    categoriasCentrais: centrais,
    corporativo: { ...fmt(corporativo), fonte: corporativo.fonte, premissa: corporativo.premissa || null },
    local: { ...fmt(local), categorias: locais },
    total: { pecasAno: corporativo.pecasAno + local.pecasAno, valorAno: corporativo.valorIncompleto || local.valorIncompleto ? null : Math.round(((corporativo.valorAno || 0) + local.valorAno) * 100) / 100 },
    unidadesSemCalculo: semCalculo,
    porUnidade: porUnidade.map(({ unidade, potencial }) => ({ unidadeId: unidade.id, nome: unidade.nome, cidade: unidade.cidade, ...potencial })),
    observacao: 'Estimativa a partir de funcionários locais e premissas de consumo; não é pedido nem contrato.',
  };
}

// ------------------------------------------------------------------ abordagem e distribuição

/** Negociações abertas no grupo (corporativas e por unidade) para conferir ANTES de abordar uma unidade. */
function verificarAbordagem(base, { grupoId, unidadeId }) {
  const uni = unidadeId ? base.exigir('unidade', unidadeId) : null;
  const gid = grupoId || (uni && uni.grupoId);
  if (!gid) throw new ErroNegocio('ARGUMENTO_AUSENTE', 'Informe --grupo ou --unidade.');
  const g = base.exigir('grupo', gid);
  const agentes = Object.fromEntries(base.listar('agente').map((a) => [a.id, a.nome]));
  const abertas = base.listar('oportunidade').filter((o) => o.grupoId === g.id && ETAPAS_ABERTAS.includes(o.etapa));
  const corporativas = abertas.filter((o) => o.canal === 'corporativo' || !o.unidadeId);
  const destaUnidade = uni ? abertas.filter((o) => o.unidadeId === uni.id) : [];
  const outrasUnidades = abertas.filter((o) => o.unidadeId && (!uni || o.unidadeId !== uni.id) && o.canal !== 'corporativo');
  const resumo = (o) => ({ id: o.id, titulo: o.titulo, etapa: o.etapa, responsavelId: o.responsavelId, responsavel: agentes[o.responsavelId] || o.responsavelId, unidadeId: o.unidadeId || null, canal: o.canal || null });
  let orientacao;
  if (destaUnidade.length) orientacao = 'Já existe negociação nesta unidade: fale com o responsável antes de qualquer contato.';
  else if (corporativas.length && g.modeloCompra !== 'descentralizada') orientacao = `Negociação corporativa em andamento (compra ${g.modeloCompra}): alinhe com o responsável corporativo antes de abordar a unidade.`;
  else orientacao = 'Livre para abordar, registrando a oportunidade com grupoId e unidadeId.';
  return {
    grupo: { id: g.id, nome: g.nome, modeloCompra: g.modeloCompra, responsavelGrupo: agentes[g.responsavelId] || null, responsavelCorporativo: agentes[g.responsavelCorporativoId] || null },
    unidade: uni ? { id: uni.id, nome: uni.nome, responsavel: agentes[uni.responsavelId] || null, status: uni.status } : null,
    corporativas: corporativas.map(resumo),
    destaUnidade: destaUnidade.map(resumo),
    outrasUnidades: outrasUnidades.map(resumo),
    livre: !destaUnidade.length && !(corporativas.length && g.modeloCompra !== 'descentralizada'),
    orientacao,
  };
}

/**
 * Conferência na criação de oportunidade de grande conta: completa o grupo pela unidade e bloqueia
 * abordagem paralela (mesma unidade, ou unidade de grupo com negociação corporativa de outro responsável).
 */
function conferirOportunidadeConta(base, dados) {
  if (!dados.grupoId && !dados.unidadeId) return dados;
  const out = { ...dados };
  if (out.unidadeId) {
    const u = base.exigir('unidade', out.unidadeId);
    if (out.grupoId && out.grupoId !== u.grupoId) throw new ErroNegocio('GRUPO_DIVERGENTE', `Unidade ${u.id} é do grupo ${u.grupoId}, não de ${out.grupoId}.`);
    out.grupoId = u.grupoId;
  }
  if (!out.canal) out.canal = out.unidadeId ? 'local' : 'corporativo';
  const v0 = verificarAbordagem(base, { grupoId: out.grupoId, unidadeId: out.unidadeId });
  // Numa atualização, a própria oportunidade não conta como conflito.
  const semEla = (lista) => lista.filter((o) => o.id !== out.id);
  const v = { ...v0, destaUnidade: semEla(v0.destaUnidade), corporativas: semEla(v0.corporativas) };
  const outra = (lista) => lista.find((o) => o.responsavelId !== out.responsavelId);
  if (out.unidadeId && v.destaUnidade.length) {
    throw new ErroNegocio('CONFLITO_CONTA', `Já existe negociação aberta nesta unidade: ${v.destaUnidade.map((o) => `${o.id} (${o.responsavel})`).join(', ')}. Atualize-a em vez de abrir outra.`);
  }
  if (out.canal === 'local' && v.corporativas.length && v.grupo.modeloCompra === 'centralizada' && outra(v.corporativas)) {
    throw new ErroNegocio('CONFLITO_CONTA', `O grupo compra de forma centralizada e já há negociação corporativa: ${v.corporativas.map((o) => `${o.id} (${o.responsavel})`).join(', ')}. Combine com o responsável corporativo (o gerente pode transferir).`);
  }
  if (out.canal === 'corporativo' && v.corporativas.length) {
    throw new ErroNegocio('CONFLITO_CONTA', `Já existe negociação corporativa aberta neste grupo: ${v.corporativas.map((o) => `${o.id} (${o.responsavel})`).join(', ')}.`);
  }
  return out;
}

/** Distribuição: vendedor do grupo, responsável corporativo ou vendedor de uma unidade (gerente ou acima). */
function atribuir(base, agente, { grupoId, unidadeId, responsavelId, papel }) {
  if (H.nivel(agente) < H.nivel('gerente')) throw new ErroNegocio('PERMISSAO_NEGADA', 'Distribuição de grandes contas é do gerente comercial (ou acima).');
  const resp = base.exigir('agente', responsavelId);
  if (!resp.ativo) throw new ErroNegocio('AGENTE_INATIVO', `${resp.id} (${resp.nome}) está inativo.`);
  if (unidadeId) return base.atualizar('unidade', unidadeId, { responsavelId }, agente, { acao: 'atribuir' });
  if (!grupoId) throw new ErroNegocio('ARGUMENTO_AUSENTE', 'Informe --grupo ou --unidade.');
  const campo = papel === 'corporativo' ? 'responsavelCorporativoId' : 'responsavelId';
  return base.atualizar('grupo', grupoId, { [campo]: responsavelId }, agente, { acao: 'atribuir' });
}

// ------------------------------------------------------------------ visões

/** Árvore do grupo: empresas → unidades, compradores por nível, oportunidades, pedidos e histórico. */
function arvoreGrupo(base, grupoId, premissas = premissasContas(base)) {
  const g = base.exigir('grupo', grupoId);
  const empresas = base.listar('empresa').filter((e) => e.grupoId === g.id);
  const unidades = base.listar('unidade').filter((u) => u.grupoId === g.id);
  const compradores = base.listar('comprador').filter((c) => c.grupoId === g.id);
  const opos = base.listar('oportunidade').filter((o) => o.grupoId === g.id);
  const clientes = new Set([g.clienteId, ...empresas.map((e) => e.clienteId), ...unidades.map((u) => u.clienteId)].filter(Boolean));
  const pedidos = base.listar('pedido').filter((p) => clientes.has(p.clienteId) && p.status !== 'cancelado');
  const propostas = base.listar('proposta').filter((p) => opos.some((o) => o.id === p.oportunidadeId));
  const atividades = base.listar('atividade').filter((a) => a.grupoId === g.id).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const consolidado = consolidadoGrupo(base, g.id, premissas);
  const pot = Object.fromEntries(consolidado.porUnidade.map((p) => [p.unidadeId, p]));
  const unidadeView = (u) => ({
    ...u,
    grandeSP: naGrandeSP(u.cidade),
    potencial: pot[u.id],
    compradores: compradores.filter((c) => c.unidadeId === u.id),
    oportunidades: opos.filter((o) => o.unidadeId === u.id).map((o) => ({ id: o.id, titulo: o.titulo, etapa: o.etapa, valorEstimado: o.valorEstimado })),
  });
  return {
    grupo: { ...g, elegibilidade: elegibilidade(g) },
    funcionarios: {
      grupo: g.colaboradoresGrupo || null,
      brasil: g.colaboradoresBrasil || null,
      porEmpresa: empresas.map((e) => ({ empresaId: e.id, razaoSocial: e.razaoSocial, brasil: e.colaboradoresBrasil || null })),
      unidadesComDadoLocal: unidades.filter((u) => u.funcionariosLocais && u.funcionariosLocais.valor != null).length,
      observacao: 'Abrangências diferentes: não some grupo, Brasil e unidades.',
    },
    empresas: empresas.map((e) => ({ ...e, unidades: unidades.filter((u) => u.empresaId === e.id).map(unidadeView) })),
    unidadesSemEmpresa: unidades.filter((u) => !u.empresaId).map(unidadeView),
    compradoresCorporativos: compradores.filter((c) => c.nivel === 'corporativo'),
    consolidado,
    oportunidades: opos,
    propostasEnviadas: propostas.filter((p) => ['enviada', 'aceita', 'recusada'].includes(p.status)).length,
    pedidos: { quantidade: pedidos.length, receitaRealizada: Math.round(pedidos.reduce((s, p) => s + p.valorTotal, 0) * 100) / 100 },
    historico: atividades.slice(0, 50),
  };
}

/** Painel de grandes contas: números consolidados sem dupla contagem. */
function painelContas(base, premissas = premissasContas(base)) {
  const grupos = base.listar('grupo');
  const unidades = base.listar('unidade');
  const compradores = base.listar('comprador');
  const opos = base.listar('oportunidade').filter((o) => o.grupoId);
  const agentes = Object.fromEntries(base.listar('agente').map((a) => [a.id, a.nome]));
  const porGrupo = grupos.map((g) => {
    const arv = arvoreGrupo(base, g.id, premissas);
    const us = unidades.filter((u) => u.grupoId === g.id);
    return {
      id: g.id,
      nome: g.nome,
      status: g.status,
      modeloCompra: g.modeloCompra,
      elegibilidade: arv.grupo.elegibilidade,
      colaboradoresGrupo: g.colaboradoresGrupo || null,
      colaboradoresBrasil: g.colaboradoresBrasil || null,
      empresas: arv.empresas.length,
      unidades: us.length,
      unidadesGrandeSP: us.filter((u) => naGrandeSP(u.cidade)).length,
      naoExploradas: us.filter((u) => u.status === 'nao_explorada').length,
      compradoresCorporativos: compradores.filter((c) => c.grupoId === g.id && c.nivel === 'corporativo').length,
      compradoresLocais: compradores.filter((c) => c.grupoId === g.id && c.nivel === 'local').length,
      oportunidadesAbertas: opos.filter((o) => o.grupoId === g.id && ETAPAS_ABERTAS.includes(o.etapa)).length,
      potencial: arv.consolidado.total,
      propostasEnviadas: arv.propostasEnviadas,
      pedidos: arv.pedidos,
      responsavel: agentes[g.responsavelId] || null,
      responsavelCorporativo: agentes[g.responsavelCorporativoId] || null,
    };
  });
  const porCidade = {};
  for (const u of unidades) {
    const k = u.cidade;
    const c = (porCidade[k] = porCidade[k] || { cidade: k, grandeSP: naGrandeSP(k), unidades: 0, grupos: new Set(), oportunidades: 0 });
    c.unidades++;
    c.grupos.add(u.grupoId);
    c.oportunidades += opos.filter((o) => o.unidadeId === u.id && ETAPAS_ABERTAS.includes(o.etapa)).length;
  }
  const somaValor = porGrupo.every((g) => g.potencial.valorAno != null) ? porGrupo.reduce((s, g) => s + g.potencial.valorAno, 0) : null;
  const evidenciados = (nivel) => compradores.filter((c) => c.nivel === nivel && c.confirmacao === 'evidenciada').length;
  return {
    estimativa: 'Potenciais são estimativas por premissa (config/premissas_contas.json); pedidos e receita são dados confirmados.',
    totais: {
      grupos: grupos.length,
      gruposElegiveis: porGrupo.filter((g) => ['elegivel', 'elegivel_estimado'].includes(g.elegibilidade.status)).length,
      empresas: base.listar('empresa').length,
      unidades: unidades.length,
      unidadesGrandeSP: unidades.filter((u) => naGrandeSP(u.cidade)).length,
      unidadesNaoExploradas: unidades.filter((u) => u.status === 'nao_explorada').length,
      compradoresCorporativos: compradores.filter((c) => c.nivel === 'corporativo').length,
      compradoresLocais: compradores.filter((c) => c.nivel === 'local').length,
      compradoresEvidenciados: { corporativos: evidenciados('corporativo'), locais: evidenciados('local') },
      oportunidadesCentralizadas: opos.filter((o) => ETAPAS_ABERTAS.includes(o.etapa) && (grupos.find((g) => g.id === o.grupoId) || {}).modeloCompra === 'centralizada').length,
      oportunidadesDescentralizadas: opos.filter((o) => ETAPAS_ABERTAS.includes(o.etapa) && (grupos.find((g) => g.id === o.grupoId) || {}).modeloCompra === 'descentralizada').length,
      oportunidadesEmNegociacao: opos.filter((o) => ['proposta_enviada', 'negociacao', 'aguardando_decisao'].includes(o.etapa)).length,
      propostasEnviadas: porGrupo.reduce((s, g) => s + g.propostasEnviadas, 0),
      pedidosConquistados: porGrupo.reduce((s, g) => s + g.pedidos.quantidade, 0),
      receitaRealizada: Math.round(porGrupo.reduce((s, g) => s + g.pedidos.receitaRealizada, 0) * 100) / 100,
      potencialPecasAno: porGrupo.reduce((s, g) => s + g.potencial.pecasAno, 0),
      potencialValorAno: somaValor == null ? null : Math.round(somaValor * 100) / 100,
    },
    grupos: porGrupo,
    cidades: Object.values(porCidade).map((c) => ({ ...c, grupos: [...c.grupos] })).sort((a, b) => b.unidades - a.unidades),
  };
}

/** Conferências do comprador (cadastro e atualização). */
function conferirComprador(base, dados) {
  base.exigir('grupo', dados.grupoId);
  if (dados.nivel === 'local' && !dados.unidadeId) throw new ErroNegocio('ARGUMENTO_AUSENTE', 'Comprador local precisa de unidadeId.');
  if (dados.unidadeId && base.exigir('unidade', dados.unidadeId).grupoId !== dados.grupoId) throw new ErroNegocio('GRUPO_DIVERGENTE', 'A unidade do comprador é de outro grupo.');
  if (dados.confirmacao === 'evidenciada' && !String(dados.evidenciaFuncao || '').trim()) {
    throw new ErroNegocio('EVIDENCIA_AUSENTE', 'Para marcar a função como "evidenciada", descreva a evidência em evidenciaFuncao (o cargo sozinho não basta).');
  }
}

/** Criação de registros de grandes contas com as conferências deste módulo. */
function registrarConta(base, agente, entidade, dados) {
  P.podeCriar(agente, entidade, dados);
  let d = dados;
  if (entidade === 'unidade') d = conferirUnidade(base, { status: 'nao_explorada', potencialContrato: 'desconhecido', ...dados });
  if (entidade === 'empresa') base.exigir('grupo', dados.grupoId);
  if (entidade === 'comprador') conferirComprador(base, dados);
  if (entidade === 'grupo') d = { modeloCompra: 'desconhecido', status: 'mapeando', ...dados };
  return base.criar(entidade, d, agente);
}

module.exports = {
  PORTE_MINIMO,
  naGrandeSP,
  premissasContas,
  classificarCnpj,
  conferirUnidade,
  elegibilidade,
  potencialUnidade,
  categoriasCentrais,
  consolidadoGrupo,
  verificarAbordagem,
  conferirOportunidadeConta,
  atribuir,
  arvoreGrupo,
  painelContas,
  registrarConta,
  conferirComprador,
};
