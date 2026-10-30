'use strict';

/**
 * Rotinas programadas de cada agente dentro do expediente.
 *  - `hora`: roda uma vez por dia no horário (tolerância de atraso: 60 min, p/ reinícios);
 *  - `aCadaMin`: roda uma vez por janela de N minutos, a partir da abertura;
 *  - `dias`: dias da semana (0=dom ... 6=sáb). Padrão: os dias do expediente.
 * `instrucao` vai para o agente (modo claude); `simulado` são os comandos executados no modo simulado.
 */

const { local, paraMinutos } = require('./horario');

const RONDA =
  'Ronda de follow-up: verifique pipeline sem-follow-up e propostas-pendentes. Para itens novos (sem tarefa aberta), crie tarefa ao vendedor ' +
  '(no máximo 3, as mais valiosas). Seja breve; se nada mudou desde a última ronda, apenas informe.';

const ROTINAS = [
  {
    id: 'vendedor-abertura',
    papel: 'vendedor',
    hora: '06:30',
    titulo: 'Abertura do dia do vendedor',
    instrucao:
      'Abertura do dia. Use pipeline sem-follow-up e pipeline dados-ausentes (não abra oportunidade por oportunidade). ' +
      'Liste os próximos passos de hoje por vendedor, sem registrar atividades novas. Não invente dados. Termine com um resumo curto para o gerente.',
    simulado: [['listar', 'agente', '--filtro', 'papel=vendedor'], ['pipeline', 'sem-follow-up'], ['pipeline', 'dados-ausentes']],
  },
  {
    id: 'gerente-reuniao-diaria',
    papel: 'gerente',
    hora: '06:45',
    titulo: 'Reunião diária do gerente',
    instrucao:
      'Reunião diária. Gere o relatório do gerente, revise oportunidades paradas, sem follow-up e propostas pendentes. ' +
      'Crie no máximo 5 tarefas para o vendedor (tarefa criar --responsavel vendedor), as mais valiosas, com prazo e condição de conclusão, sem duplicar tarefas abertas ' +
      '(confira com tarefa listar --todas). Escale ao diretor o que exceder sua alçada. Salve o relatório (--salvar).',
    simulado: [['relatorio', 'gerente', '--salvar'], ['pipeline', 'parados'], ['pipeline', 'propostas-pendentes']],
  },
  {
    id: 'diretor-riscos',
    papel: 'diretor',
    hora: '09:00',
    titulo: 'Riscos e aprovações do diretor',
    instrucao:
      'Revise pedidos em risco de atraso (pipeline pedidos-risco) e aprovações pendentes na sua alçada (aprovacao listar --status pendente). ' +
      'Decida o que couber na sua alçada com justificativa; escale ao CEO o que exceder. Para pedidos em risco, registre o que precisa ser ' +
      'confirmado com PCP/expedição (o contato com essas áreas é feito pelo responsável humano).',
    simulado: [['pipeline', 'pedidos-risco'], ['aprovacao', 'listar', '--status', 'pendente']],
  },
  {
    id: 'gerente-follow-up',
    papel: 'gerente',
    hora: '11:00',
    titulo: 'Ronda de follow-up (manhã)',
    instrucao: RONDA,
    simulado: [['pipeline', 'sem-follow-up'], ['pipeline', 'propostas-pendentes']],
  },
  {
    id: 'gerente-follow-up-tarde',
    papel: 'gerente',
    hora: '15:30',
    titulo: 'Ronda de follow-up (tarde)',
    instrucao: RONDA,
    simulado: [['pipeline', 'sem-follow-up'], ['pipeline', 'propostas-pendentes']],
  },
  {
    id: 'hunter-pesquisa',
    papel: 'hunter',
    hora: '10:00',
    titulo: 'Pesquisa de grandes contas',
    instrucao:
      'Pesquisa de grandes contas (um grupo por rodada). 1) Rode conta consolidado para ver o que já existe. ' +
      '2) Se houver grupo com status "mapeando", continue por ele (unidades da Grande São Paulo sem funcionários locais, compradores faltando). ' +
      'Senão, encontre UM novo grupo com 1.000+ colaboradores e instalações na Grande São Paulo, em segmento-alvo (saúde, indústria, ' +
      'logística, facilities, construção, serviços), que ainda não esteja na base (confira com listar grupo e listar empresa). ' +
      '3) Registre grupo, empresas, unidades e compradores com fonte e data; números por abrangência (grupo, Brasil, unidade) com evidência; ' +
      'compradores "evidenciada" só com evidência da função. 4) Ao concluir o grupo, atualize o status para "mapeado" e escale ao gerente ' +
      '(solicitacao criar --fluxo escalonamento --para gerente) com o resumo e a estratégia recomendada. Use poucas buscas e não repita pesquisa já registrada.',
    simulado: [['conta', 'consolidado']],
  },
  {
    id: 'gerente-fechamento',
    papel: 'gerente',
    hora: '18:00',
    titulo: 'Fechamento do dia',
    instrucao: 'Fechamento do dia: gere e salve o relatório do gerente (--salvar) e verifique tarefas entregues aguardando sua verificação.',
    simulado: [['relatorio', 'gerente', '--salvar'], ['tarefa', 'listar', '--todas']],
  },
  {
    id: 'diretor-semanal',
    papel: 'diretor',
    hora: '17:00',
    dias: [5],
    titulo: 'Relatório semanal do diretor',
    instrucao: 'Gere e salve o relatório semanal do diretor (--salvar) com sua análise. Registre ao CEO (escalonamento) as decisões que precisam dele.',
    simulado: [['relatorio', 'diretor', '--salvar'], ['pipeline', 'previsao']],
  },
  {
    id: 'ceo-executivo',
    papel: 'ceo',
    hora: '18:00',
    dias: [5],
    titulo: 'Relatório executivo do CEO',
    instrucao:
      'Gere e salve o relatório executivo (--salvar) com análise, riscos e decisões necessárias. Registre diretrizes ao diretor quando houver ' +
      'e escale ao humano (solicitacao criar --fluxo escalonamento --para humano) o que exceder sua autoridade, com alternativas e impactos.',
    simulado: [['relatorio', 'ceo', '--salvar'], ['pipeline', 'concentracao']],
  },
];

const TOLERANCIA_MIN = 60;

/**
 * Rotinas vencidas no instante `agora` que ainda não rodaram no slot atual.
 * Devolve [{ rotina, slot }]; o slot identifica a execução (evita repetir após reinício).
 */
function vencidas(agora, cfg, executadas, rotinas = ROTINAS) {
  const l = local(agora, cfg.fuso);
  const abre = paraMinutos(cfg.expediente.abre);
  const out = [];
  for (const r of rotinas) {
    const dias = r.dias || cfg.expediente.dias;
    if (!dias.includes(l.diaSemana)) continue;
    let slot = null;
    if (r.hora) {
      const m = paraMinutos(r.hora);
      if (l.minutos >= m && l.minutos < m + TOLERANCIA_MIN) slot = `${l.data}T${r.hora}`;
    } else if (r.aCadaMin) {
      if (l.minutos >= abre) slot = `${l.data}#${Math.floor((l.minutos - abre) / r.aCadaMin)}`;
    }
    if (slot && !executadas.has(`${r.id}@${slot}`)) out.push({ rotina: r, slot });
  }
  return out;
}

module.exports = { ROTINAS, vencidas, TOLERANCIA_MIN };
