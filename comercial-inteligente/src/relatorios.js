'use strict';

/**
 * Relatórios padronizados (seção 11). Todo relatório tem as mesmas seis seções,
 * na mesma ordem, e nunca fabrica resultado: sem dado, a seção diz "sem dados".
 */

const A = require('./analises');
const { ROTULO_ETAPA, ETAPAS_ABERTAS } = require('./dominio');
const { listarSolicitacoes } = require('./protocolo');

const SECOES = [
  ['confirmados', '1. Dados confirmados'],
  ['estimativas', '2. Estimativas'],
  ['premissas', '3. Premissas'],
  ['ausentes', '4. Dados ausentes'],
  ['recomendacoes', '5. Recomendações'],
  ['decisoes', '6. Decisões pendentes de aprovação'],
];

const moeda = (v) => (v == null ? 'n/d' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v));
const pct = (v) => (v == null ? 'n/d' : `${String(v).replace('.', ',')}%`);

function tabela(cabecalho, linhas) {
  if (!linhas.length) return null;
  const esc = (c) => String(c == null ? '—' : c).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${cabecalho.join(' | ')} |`, `| ${cabecalho.map(() => '---').join(' | ')} |`, ...linhas.map((l) => `| ${l.map(esc).join(' | ')} |`)].join('\n');
}

class Relatorio {
  constructor(tipo, titulo, base, hoje) {
    this.tipo = tipo;
    this.titulo = titulo;
    this.base = base;
    this.hoje = hoje;
    this.s = Object.fromEntries(SECOES.map(([k]) => [k, []]));
  }

  add(secao, bloco) {
    if (bloco) this.s[secao].push(bloco);
    return this;
  }

  /** Adiciona tabela ou, se vazia, a frase explícita de ausência. */
  lista(secao, rotulo, cabecalho, linhas, vazioTexto) {
    const t = tabela(cabecalho, linhas);
    return this.add(secao, t ? `**${rotulo}**\n\n${t}` : `**${rotulo}:** ${vazioTexto || 'nenhum registro.'}`);
  }

  markdown() {
    const cab = [
      `# ${this.titulo}`,
      '',
      `- Data de referência: ${this.hoje}`,
      `- Base: ${this.base.ficticia ? 'DEMONSTRAÇÃO — **TODOS OS DADOS SÃO FICTÍCIOS**' : 'produção'}`,
      `- Política comercial: ${this.base.politica().configurado ? 'configurada' : '**NÃO CONFIGURADA** — toda proposta exige decisão humana'}`,
      `- Gerado por: motor determinístico \`comercial-inteligente\` (a análise qualitativa do agente vem depois deste bloco e não altera os números)`,
    ];
    const corpo = SECOES.flatMap(([k, rotulo]) => ['', `## ${rotulo}`, '', ...(this.s[k].length ? this.s[k].flatMap((b) => [b, '']) : ['Sem dados para esta seção na base atual.', ''])]);
    return [...cab, ...corpo].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  json() {
    return { tipo: this.tipo, titulo: this.titulo, hoje: this.hoje, ficticio: this.base.ficticia, secoes: this.s };
  }
}

function premissasPadrao(r, premissas) {
  r.add('premissas', `- Probabilidades por etapa do funil (premissa operacional, \`${premissas._arquivo}\`): ${ETAPAS_ABERTAS.map((e) => `${e} ${Math.round(premissas.probabilidadePorEtapa[e] * 100)}%`).join(', ')}.`);
  r.add('premissas', `- Oportunidade "parada": sem contato há mais de ${premissas.diasSemContatoParaAlerta} dias. Cliente inativo: sem compra há mais de ${premissas.diasInatividadeCliente} dias.`);
  r.add('premissas', '- Faturamento confirmado = pedidos com status "faturado" ou "expedido" registrados na base (importados do ERP ou com evidência).');
}

function nomeAgente(base, id) {
  const a = id && base.obter('agente', id);
  return a ? a.nome : id || '—';
}

function decisoesAbertas(r, base, papeis) {
  const aprs = base.listar('aprovacao').filter((a) => a.status === 'pendente' && (!papeis || papeis.includes(a.alcadaNecessaria)));
  r.lista('decisoes', 'Aprovações pendentes', ['Aprovação', 'Objeto', 'Alçada exigida', 'Solicitada por', 'Motivos'], aprs.map((a) => [a.id, `${a.objetoTipo} ${a.objetoId}`, a.alcadaNecessaria, a.solicitadoPor, a.motivos.join(' / ')]), 'nenhuma.');
}

function solicitacoesAbertas(r, base, papel, hoje) {
  const sols = listarSolicitacoes(base, { agente: papel, hoje }).filter((s) => s.status !== 'concluida');
  r.lista(
    'decisoes',
    `Solicitações abertas envolvendo "${papel}"`,
    ['ID', 'De → Para', 'Fluxo', 'Objetivo', 'Prazo', 'Status'],
    sols.map((s) => [s.id, `${s.solicitante} → ${s.responsavel}`, s.fluxo, s.objetivo, `${s.prazo}${s.vencida ? ' (VENCIDA)' : ''}`, s.status]),
    'nenhuma.',
  );
}

// ------------------------------------------------------------------ vendedor

function vendedor(base, { hoje, responsavelId }) {
  const premissas = base.premissas();
  const r = new Relatorio('vendedor', `Relatório diário do vendedor — ${nomeAgente(base, responsavelId)}`, base, hoje);
  const ativs = base.listar('atividade').filter((a) => a.responsavelId === responsavelId && a.data === hoje);
  r.lista('confirmados', 'Contatos e atividades do dia', ['ID', 'Tipo', 'Oportunidade', 'Resumo', 'Resultado'], ativs.map((a) => [a.id, a.tipo, a.oportunidadeId, a.resumo, a.resultado]), 'nenhuma atividade registrada hoje.');
  r.add('confirmados', `**Respostas de clientes hoje:** ${ativs.filter((a) => a.resultado === 'resposta_recebida').length}`);

  const minhas = base.listar('oportunidade').filter((o) => o.responsavelId === responsavelId);
  const ids = new Set(minhas.map((o) => o.id));
  const props = A.propostasPendentes(base, { hoje, premissas }).filter((p) => ids.has(p.oportunidadeId));
  r.lista('confirmados', 'Propostas em andamento', ['Proposta', 'Cliente', 'Status', 'Valor', 'Alertas'], props.map((p) => [p.id, p.cliente, p.status, moeda(p.valor), p.alertas.join('; ')]));
  const negoc = minhas.filter((o) => ['negociacao', 'aguardando_decisao'].includes(o.etapa));
  r.lista('confirmados', 'Negociações', ['Oportunidade', 'Título', 'Etapa', 'Próximo passo'], negoc.map((o) => [o.id, o.titulo, ROTULO_ETAPA[o.etapa], o.proximoPasso]));
  const fech = minhas.filter((o) => o.fechadoEm === hoje);
  r.lista('confirmados', 'Fechamentos de hoje', ['Oportunidade', 'Resultado', 'Motivo de perda'], fech.map((o) => [o.id, ROTULO_ETAPA[o.etapa], o.motivoPerda]), 'nenhum.');

  const f = A.funil(base, { responsavelId }).filter((x) => ETAPAS_ABERTAS.includes(x.etapa) && x.quantidade);
  r.lista('estimativas', 'Pipeline aberto (valor estimado, não confirmado)', ['Etapa', 'Qtd', 'Valor estimado', 'Sem valor'], f.map((x) => [ROTULO_ETAPA[x.etapa], x.quantidade, moeda(x.valor), x.semValor]));
  premissasPadrao(r, premissas);

  const aus = A.dadosAusentes(base, { responsavelId });
  r.lista('ausentes', 'Oportunidades com dados obrigatórios faltando', ['Oportunidade', 'Cliente', 'Etapa', 'Falta'], aus.map((x) => [x.id, x.cliente, x.etapa, x.faltando.join(', ')]), 'nenhuma.');

  const amanha = A.somarDias(hoje, 1);
  const agenda = minhas.filter((o) => ETAPAS_ABERTAS.includes(o.etapa) && o.proximoPassoEm && o.proximoPassoEm <= amanha);
  r.lista('recomendacoes', 'Próximos passos (até amanhã)', ['Oportunidade', 'Cliente', 'Próximo passo', 'Data'], agenda.map((o) => [o.id, o.titulo, o.proximoPasso, o.proximoPassoEm]), 'nenhum agendado.');
  const sem = A.semFollowUp(base, { hoje, responsavelId });
  for (const x of sem) r.add('recomendacoes', `- Definir próximo passo e data para ${x.id} (${x.cliente}): ${x.motivos.join(', ')}.`);
  for (const x of aus.filter((a) => a.faltando.some((f2) => f2.startsWith('qualificacao.')))) {
    r.add('recomendacoes', `- Completar qualificação de ${x.id} antes de pedir cotação: ${x.faltando.filter((f2) => f2.startsWith('qualificacao.')).join(', ')}.`);
  }

  const aprs = base.listar('aprovacao').filter((a) => a.status === 'pendente' && a.objetoTipo === 'proposta' && ids.has((base.obter('proposta', a.objetoId) || {}).oportunidadeId));
  r.lista('decisoes', 'Aprovações pendentes das minhas propostas', ['Aprovação', 'Proposta', 'Alçada exigida'], aprs.map((a) => [a.id, a.objetoId, a.alcadaNecessaria]), 'nenhuma.');
  solicitacoesAbertas(r, base, 'vendedor', hoje);
  return r;
}

// ------------------------------------------------------------------ gerente

function gerente(base, { hoje }) {
  const premissas = base.premissas();
  const r = new Relatorio('gerente', 'Relatório diário do gerente comercial', base, hoje);
  const { inicio } = A.intervaloMes(hoje);
  const desemp = A.desempenhoPorVendedor(base, { inicio, fim: hoje });
  r.lista('confirmados', `Desempenho por vendedor (${inicio} a ${hoje})`, ['Vendedor', 'Atividades', 'Contatos', 'Propostas enviadas', 'Ganhas', 'Perdidas', 'Conversão'], desemp.map((d) => [d.nome, d.atividades, d.contatos, d.propostasEnviadas, d.ganhas, d.perdidas, pct(d.conversao)]));
  const parados = A.parados(base, { hoje, diasLimite: premissas.diasSemContatoParaAlerta });
  r.lista('confirmados', 'Oportunidades paradas', ['Oportunidade', 'Cliente', 'Responsável', 'Etapa', 'Dias sem contato'], parados.map((p) => [p.id, p.cliente, nomeAgente(base, p.responsavelId), p.etapa, p.diasSemContato == null ? 'sem registro' : p.diasSemContato]), 'nenhuma.');
  const sem = A.semFollowUp(base, { hoje });
  r.lista('confirmados', 'Oportunidades sem próximo passo / follow-up vencido', ['Oportunidade', 'Cliente', 'Responsável', 'Motivo'], sem.map((x) => [x.id, x.cliente, nomeAgente(base, x.responsavelId), x.motivos.join(', ')]), 'nenhuma.');
  const props = A.propostasPendentes(base, { hoje, premissas });
  r.lista('confirmados', 'Propostas pendentes', ['Proposta', 'Cliente', 'Status', 'Valor', 'Alertas'], props.map((p) => [p.id, p.cliente, p.status, moeda(p.valor), p.alertas.join('; ')]), 'nenhuma.');
  const tarefas = base.listar('tarefa').filter((t) => t.status !== 'concluida');
  r.lista('confirmados', 'Tarefas abertas', ['Tarefa', 'Responsável', 'Prazo', 'Status'], tarefas.map((t) => [t.id, t.responsavel, `${t.prazo}${t.prazo < hoje ? ' (VENCIDA)' : ''}`, t.status]), 'nenhuma.');

  r.lista('estimativas', 'Pipeline aberto por vendedor (estimado)', ['Vendedor', 'Pipeline aberto', 'Oportunidades sem valor'], desemp.map((d) => [d.nome, moeda(d.pipelineAberto), d.semValorEstimado]));
  premissasPadrao(r, premissas);

  const aus = A.dadosAusentes(base);
  r.lista('ausentes', 'Qualidade do CRM — dados obrigatórios faltando', ['Oportunidade', 'Responsável', 'Falta'], aus.map((x) => [x.id, nomeAgente(base, x.responsavelId), x.faltando.join(', ')]), 'nenhuma pendência.');
  const dups = A.duplicidades(base);
  r.lista('ausentes', 'Possíveis duplicidades', ['Chave', 'Registros'], dups.map((d) => [d.chave, d.ids.join(', ')]), 'nenhuma.');

  const prioridades = A.semFollowUp(base, { hoje })
    .map((x) => ({ ...x, valor: (base.obter('oportunidade', x.id) || {}).valorEstimado || 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10);
  for (const p of prioridades) r.add('recomendacoes', `- Prioridade: ${p.id} (${p.cliente}, ${moeda(p.valor || null)}) — ${p.motivos.join(', ')}; cobrar ${nomeAgente(base, p.responsavelId)}.`);
  for (const p of props.filter((x) => x.alertas.some((a) => a.startsWith('sem resposta')))) r.add('recomendacoes', `- Programar follow-up da proposta ${p.id} (${p.cliente}).`);
  if (aus.length) r.add('recomendacoes', `- Cobrar atualização do CRM: ${aus.length} oportunidade(s) com campo obrigatório vazio.`);

  decisoesAbertas(r, base, ['vendedor', 'gerente']);
  solicitacoesAbertas(r, base, 'gerente', hoje);
  return r;
}

// ------------------------------------------------------------------ diretor

function diretor(base, { hoje }) {
  const premissas = base.premissas();
  const r = new Relatorio('diretor', 'Relatório semanal do diretor comercial', base, hoje);
  const semanaIni = A.somarDias(hoje, -6);
  const { inicio, periodo } = A.intervaloMes(hoje);
  const fat = A.faturamento(base, { inicio, fim: hoje });
  r.add('confirmados', `**Faturamento confirmado no mês (${inicio} a ${hoje}):** ${moeda(fat.total)} em ${fat.pedidos} pedido(s).`);
  const ms = A.metas(base, { periodo });
  r.lista('confirmados', `Metas de ${periodo}`, ['Meta', 'Nível', 'Responsável/segmento', 'Meta', 'Realizado', 'Atingimento', 'Status'], ms.map((m) => [m.id, m.nivel, m.segmento || nomeAgente(base, m.responsavelId), moeda(m.faturamento), moeda(m.realizado), pct(m.atingimento), m.status]), 'nenhuma meta registrada para o período.');
  const f = A.funil(base);
  r.lista('confirmados', 'Funil (quantidade por etapa)', ['Etapa', 'Qtd', 'Valor estimado'], f.filter((x) => x.quantidade).map((x) => [ROTULO_ETAPA[x.etapa], x.quantidade, moeda(x.valor)]));
  const props = base.listar('proposta');
  const enviadasSemana = props.filter((p) => p.enviadaEm && p.enviadaEm >= semanaIni && p.enviadaEm <= hoje).length;
  const ganhasSemana = base.listar('oportunidade').filter((o) => ['pedido_ganho', 'pos_venda'].includes(o.etapa) && o.fechadoEm >= semanaIni && o.fechadoEm <= hoje);
  const perdidasSemana = base.listar('oportunidade').filter((o) => o.etapa === 'pedido_perdido' && o.fechadoEm >= semanaIni && o.fechadoEm <= hoje);
  r.add('confirmados', `**Semana ${semanaIni} a ${hoje}:** ${enviadasSemana} proposta(s) enviada(s); ${ganhasSemana.length} oportunidade(s) ganha(s); ${perdidasSemana.length} perdida(s).`);
  const novos = ganhasSemana.filter((o) => o.leadId && !o.clienteId).length + base.listar('cliente').filter((c) => c.status === 'ativo' && c.criadoEm.slice(0, 10) >= inicio).length;
  r.add('confirmados', `**Novos clientes no mês (cadastros ativos criados no período + ganhos a partir de lead):** ${novos}.`);
  const mg = A.margemPropostasAceitas(base);
  r.add('confirmados', `**Margem de contribuição das propostas aceitas:** ${mg.comMargemCalculada ? pct(mg.percentual) : 'não calculável'} (${mg.comMargemCalculada} de ${mg.aceitas} com margem calculada).`);
  const desc = A.descontos(base);
  r.lista('confirmados', 'Descontos concedidos', ['Proposta', 'Status', 'Desconto', 'Justificativa'], desc.map((d) => [d.id, d.status, pct(d.descontoPercent), d.justificativa || 'SEM JUSTIFICATIVA']), 'nenhum.');
  const risco = A.pedidosEmRisco(base, { hoje, diasAlerta: premissas.diasAlertaPrazoPedido });
  r.lista('confirmados', 'Pedidos com risco de atraso', ['Pedido', 'Cliente', 'Valor', 'Risco'], risco.map((p) => [p.numeroErp || p.id, p.cliente, moeda(p.valorTotal), p.risco]), 'nenhum.');
  const ciclo = base.listar('oportunidade').filter((o) => ['pedido_ganho', 'pos_venda'].includes(o.etapa) && o.fechadoEm);
  if (ciclo.length) {
    const medio = Math.round(ciclo.reduce((s, o) => s + A.dias(o.criadoEm.slice(0, 10), o.fechadoEm), 0) / ciclo.length);
    r.add('confirmados', `**Ciclo médio de vendas (oportunidades ganhas registradas):** ${medio} dia(s), n=${ciclo.length}.`);
  }

  const prev = A.previsao(base, { hoje, premissas });
  r.lista('estimativas', 'Previsão de receita', ['Janela', 'Carteira confirmada (pedidos)', 'Pipeline ponderado (estimativa)', 'Pipeline bruto'], prev.janelas.map((j) => [`${j.dias} dias (até ${j.ate})`, moeda(j.carteiraConfirmada), moeda(j.pipelinePonderado), moeda(j.pipelineBruto)]));
  const metaEmpresa = ms.find((m) => m.nivel === 'empresa' && m.status === 'aprovada');
  if (metaEmpresa) {
    const restante = Math.max(0, metaEmpresa.faturamento - fat.total);
    const ponderado30 = prev.janelas[0].pipelinePonderado;
    r.add('estimativas', `**Cobertura do pipeline:** pipeline ponderado 30 dias ${moeda(ponderado30)} ÷ meta restante ${moeda(restante)} = ${restante ? pct(Math.round((ponderado30 / restante) * 10000) / 100) : 'meta atingida'}.`);
  }
  premissasPadrao(r, premissas);

  r.lista('ausentes', 'Oportunidades fora da previsão (sem valor ou sem data de fechamento)', ['Oportunidade', 'Falta'], prev.foraDaPrevisao.map((x) => [x.id, x.falta.join(', ')]), 'nenhuma.');
  if (prev.pedidosSemPrazo.length) r.add('ausentes', `- Pedidos em aberto sem prazo de entrega: ${prev.pedidosSemPrazo.join(', ')}.`);
  if (!metaEmpresa) r.add('ausentes', `- Não há meta da empresa APROVADA para ${periodo}: atingimento e cobertura não calculados.`);
  r.add('ausentes', '- Capacidade produtiva comprometida: integração com PCP não implementada neste sistema (consultar o módulo PCP do ERP).');

  const fora = props.filter((p) => p.avaliacao && p.avaliacao.margem && p.avaliacao.margem.status !== 'calculada' && ['rascunho', 'aguardando_aprovacao'].includes(p.status));
  for (const p of fora) r.add('recomendacoes', `- Completar estrutura de custos da proposta ${p.id} (margem ${p.avaliacao.margem.status}).`);
  for (const d of desc.filter((x) => !x.justificativa)) r.add('recomendacoes', `- Exigir justificativa do desconto de ${pct(d.descontoPercent)} na proposta ${d.id}.`);
  for (const p of risco) r.add('recomendacoes', `- Alinhar com PCP/expedição o pedido ${p.numeroErp || p.id} (${p.cliente}): ${p.risco}.`);
  const inativos = A.clientesInativos(base, { hoje, diasLimite: premissas.diasInatividadeCliente });
  if (inativos.length) r.add('recomendacoes', `- Campanha de reativação para ${inativos.length} cliente(s) inativo(s): ${inativos.map((c) => c.razaoSocial).join('; ')}.`);

  decisoesAbertas(r, base, ['diretor', 'ceo', 'humano']);
  solicitacoesAbertas(r, base, 'diretor', hoje);
  return r;
}

// ------------------------------------------------------------------ ceo

function ceo(base, { hoje }) {
  const premissas = base.premissas();
  const r = new Relatorio('ceo', 'Relatório executivo do CEO', base, hoje);
  const { inicio, periodo } = A.intervaloMes(hoje);
  const fat = A.faturamento(base, { inicio, fim: hoje });
  r.add('confirmados', `**Faturamento confirmado no mês:** ${moeda(fat.total)} (${fat.pedidos} pedido(s)); ticket médio ${fat.pedidos ? moeda(Math.round((fat.total / fat.pedidos) * 100) / 100) : 'n/d'}.`);
  const ms = A.metas(base, { periodo }).filter((m) => m.nivel === 'empresa');
  r.lista('confirmados', `Meta da empresa — ${periodo}`, ['Meta', 'Valor', 'Realizado', 'Atingimento', 'Status'], ms.map((m) => [m.id, moeda(m.faturamento), moeda(m.realizado), pct(m.atingimento), m.status]), 'nenhuma meta registrada.');
  const carteira = base.listar('pedido').filter((p) => ['recebido', 'em_producao', 'pronto'].includes(p.status));
  r.add('confirmados', `**Carteira de pedidos em aberto:** ${moeda(carteira.reduce((s, p) => s + p.valorTotal, 0))} em ${carteira.length} pedido(s).`);
  const recebidosMes = base.listar('pedido').filter((p) => p.status !== 'cancelado' && p.data >= inicio && p.data <= hoje);
  r.add('confirmados', `**Pedidos recebidos no mês:** ${recebidosMes.length} (${moeda(recebidosMes.reduce((s, p) => s + p.valorTotal, 0))}).`);
  const conc = A.concentracao(base, { inicio: A.somarDias(hoje, -364), fim: hoje });
  r.lista('confirmados', 'Principais clientes (últimos 12 meses, pedidos não cancelados)', ['Cliente', 'Valor', 'Participação'], conc.ranking.slice(0, 5).map((c) => [c.cliente, moeda(c.valor), pct(c.participacao)]), 'nenhum pedido no período.');
  if (conc.total) r.add('confirmados', `**Concentração de receita:** maior cliente ${pct(conc.top1)}; 3 maiores ${pct(conc.top3)}; 5 maiores ${pct(conc.top5)}.`);
  const clientesMes = [...new Set(recebidosMes.map((p) => p.clienteId))];
  const recorrentes = clientesMes.filter((c) => base.listar('pedido').some((p) => p.clienteId === c && p.data < inicio && p.status !== 'cancelado'));
  r.add('confirmados', `**Clientes com pedido no mês:** ${clientesMes.length} (recorrentes ${recorrentes.length}, novos ${clientesMes.length - recorrentes.length}).`);
  const desemp = A.desempenhoPorVendedor(base, { inicio, fim: hoje });
  const g = desemp.reduce((s, d) => s + d.ganhas, 0);
  const p = desemp.reduce((s, d) => s + d.perdidas, 0);
  r.add('confirmados', `**Taxa de conversão no mês:** ${g + p ? pct(Math.round((g / (g + p)) * 10000) / 100) : 'n/d (nenhuma oportunidade decidida)'} (${g} ganha(s) / ${p} perdida(s)).`);
  const mg = A.margemPropostasAceitas(base);
  r.add('confirmados', `**Rentabilidade (margem de contribuição das propostas aceitas):** ${mg.comMargemCalculada ? pct(mg.percentual) : 'não calculável'} (${mg.comMargemCalculada}/${mg.aceitas} com margem calculada).`);
  const risco = A.pedidosEmRisco(base, { hoje, diasAlerta: premissas.diasAlertaPrazoPedido });
  r.lista('confirmados', 'Entregas comerciais em risco', ['Pedido', 'Cliente', 'Valor', 'Risco'], risco.map((x) => [x.numeroErp || x.id, x.cliente, moeda(x.valorTotal), x.risco]), 'nenhuma.');

  const prev = A.previsao(base, { hoje, premissas });
  r.lista('estimativas', 'Projeção 30/60/90 dias', ['Janela', 'Carteira confirmada', 'Pipeline ponderado (estimativa)', 'Total projetado'], prev.janelas.map((j) => [`${j.dias} dias`, moeda(j.carteiraConfirmada), moeda(j.pipelinePonderado), moeda(Math.round((j.carteiraConfirmada + j.pipelinePonderado) * 100) / 100)]));
  premissasPadrao(r, premissas);
  r.add('premissas', '- Concentração e principais clientes consideram os pedidos registrados nesta base, não o razão contábil.');

  r.add('ausentes', '- Inadimplência e exposição financeira dos clientes: integração com o financeiro (contas a receber do ERP) não implementada neste sistema.');
  r.add('ausentes', '- Capacidade produtiva comprometida com novos contratos: integração com PCP não implementada.');
  if (prev.foraDaPrevisao.length) r.add('ausentes', `- ${prev.foraDaPrevisao.length} oportunidade(s) fora da projeção por falta de valor ou data de fechamento.`);
  if (!ms.some((m) => m.status === 'aprovada')) r.add('ausentes', `- Meta da empresa para ${periodo} não aprovada pelo responsável humano.`);
  if (mg.aceitas > mg.comMargemCalculada) r.add('ausentes', `- ${mg.aceitas - mg.comMargemCalculada} proposta(s) aceita(s) sem margem calculada.`);

  if (conc.top1 >= 30) r.add('recomendacoes', `- Risco de concentração: maior cliente responde por ${pct(conc.top1)} da receita; priorizar diversificação da carteira.`);
  const metaAprov = ms.find((m) => m.status === 'aprovada');
  if (metaAprov && metaAprov.atingimento != null) {
    const projetado = prev.janelas[0].carteiraConfirmada + prev.janelas[0].pipelinePonderado + fat.total;
    if (projetado < metaAprov.faturamento) r.add('recomendacoes', `- Projeção (${moeda(Math.round(projetado * 100) / 100)}) abaixo da meta (${moeda(metaAprov.faturamento)}): acionar plano de recuperação com o Diretor Comercial.`);
  }
  if (risco.length) r.add('recomendacoes', `- Exigir do Diretor Comercial plano com PCP/expedição para ${risco.length} entrega(s) em risco.`);
  if (!base.politica().configurado) r.add('recomendacoes', '- Configurar a política comercial (margem mínima e alçadas) para destravar aprovações dentro da hierarquia.');

  decisoesAbertas(r, base, ['ceo', 'humano']);
  const metasPropostas = base.listar('meta').filter((m) => m.nivel === 'empresa' && m.status === 'proposta');
  r.lista('decisoes', 'Metas gerais aguardando aprovação do responsável humano', ['Meta', 'Período', 'Valor'], metasPropostas.map((m) => [m.id, m.periodo, moeda(m.faturamento)]), 'nenhuma.');
  solicitacoesAbertas(r, base, 'ceo', hoje);
  return r;
}

const GERADORES = { vendedor, gerente, diretor, ceo };

function gerar(tipo, base, opcoes) {
  const g = GERADORES[tipo];
  if (!g) throw new Error(`Relatório desconhecido: ${tipo}. Use: ${Object.keys(GERADORES).join(', ')}.`);
  return g(base, opcoes);
}

module.exports = { gerar, SECOES, Relatorio, moeda, pct };
