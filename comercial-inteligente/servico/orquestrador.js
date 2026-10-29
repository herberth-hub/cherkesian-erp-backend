'use strict';

/**
 * Orquestrador do serviço: uma fila por agente, trabalhos em paralelo (entre agentes e,
 * conforme a concorrência configurada, dentro do mesmo agente), expediente, pausas e limites.
 *
 * De onde vêm os trabalhos (a cada tick):
 *  1. rotinas programadas vencidas (rotinas.js);
 *  2. solicitações abertas na fila do agente (delegações, escalonamentos, retornos);
 *  3. entregas aguardando verificação de quem pediu (solicitação "conclusao" e tarefas);
 *  4. tarefas pendentes atribuídas ao agente.
 * Itens 2–4 só no modo claude (exigem julgamento). Nada é reprocessado sem mudança no registro,
 * e cada registro tem no máximo MAX_TENTATIVAS trabalhos por dia (depois fica para o humano).
 */

const fs = require('fs');
const path = require('path');
const { Base } = require('../src/store');
const { dentroDoExpediente, local } = require('./horario');
const { ROTINAS, vencidas } = require('./rotinas');
const { PAPEIS } = require('./config');

const MAX_TENTATIVAS = 4;

class Orquestrador {
  constructor({ cfg, executarJob, eventos, agora = () => new Date(), rotinas = ROTINAS }) {
    this.cfg = cfg;
    this.executarJob = executarJob;
    this.eventos = eventos;
    this.agora = agora;
    this.rotinas = rotinas;
    this.pausadoGeral = false;
    this.seq = 0;
    this.agentes = Object.fromEntries(
      PAPEIS.map((p) => [p, { papel: p, pausado: false, fila: [], ativos: new Map(), inicios: [], concluidos: 0, erros: 0, ultimo: null }]),
    );
    this.tokens = { data: null, total: 0 };
    this.tentativas = new Map(); // `${registro}@${data}` -> n
    this.vistos = new Set(); // chaves já enfileiradas (registro + atualizadoEm)
    this.historico = []; // últimos trabalhos concluídos
    this.estadoArquivo = null;
    this.executadas = new Set();
    this.expedienteAnterior = null;
    this.timer = null;
  }

  abrirBase() {
    return Base.abrir({ nome: this.cfg.base, dir: this.cfg.dataDir });
  }

  /** Persistência mínima: slots de rotina já executados (evita repetir após reinício). */
  carregarEstado() {
    const base = this.abrirBase();
    this.estadoArquivo = path.join(base.dir, 'servico-estado.json');
    try {
      const e = JSON.parse(fs.readFileSync(this.estadoArquivo, 'utf8'));
      this.executadas = new Set(e.executadas || []);
    } catch {
      this.executadas = new Set();
    }
  }

  salvarEstado() {
    if (!this.estadoArquivo) return;
    const ultimos = [...this.executadas].slice(-500);
    fs.writeFileSync(this.estadoArquivo, JSON.stringify({ executadas: ultimos }, null, 2));
  }

  expediente() {
    return dentroDoExpediente(this.agora(), this.cfg);
  }

  dataLocal() {
    return local(this.agora(), this.cfg.fuso).data;
  }

  // ------------------------------------------------------------ orçamento

  registrarTokens(n) {
    const hoje = this.dataLocal();
    if (this.tokens.data !== hoje) this.tokens = { data: hoje, total: 0 };
    this.tokens.total += n;
  }

  orcamentoEsgotado() {
    return this.tokens.data === this.dataLocal() && this.tokens.total >= this.cfg.limites.tokensPorDia;
  }

  // ------------------------------------------------------------ fila

  enfileirar(papel, job) {
    const a = this.agentes[papel];
    if (!a) return null;
    const ocupado = a.fila.some((j) => j.chave === job.chave) || [...a.ativos.values()].some((j) => j.chave === job.chave);
    if (ocupado) return null;
    const novo = { id: `J${++this.seq}`, papel, criadoEm: this.agora().toISOString(), ...job };
    a.fila.push(novo);
    this.eventos.emitir('enfileirado', { papel, job: novo.id, titulo: novo.titulo, origem: novo.origem });
    return novo;
  }

  /** Coleta trabalhos da base (solicitações, verificações, tarefas). */
  coletarDaBase() {
    if (this.cfg.modo !== 'claude') return;
    const base = this.abrirBase();
    const hoje = this.dataLocal();
    const sols = base.listar('solicitacao');
    const abertasFilhas = new Set(sols.filter((s) => s.status !== 'concluida' && s.origemId).map((s) => s.origemId));
    const candidatos = [];

    for (const s of sols) {
      if (s.responsavel === 'humano' || s.status === 'concluida') continue;
      if (['pendente', 'em_andamento'].includes(s.status) && !abertasFilhas.has(s.id)) {
        candidatos.push({
          papel: s.responsavel,
          registro: s.id,
          versao: s.atualizadoEm,
          titulo: `Tratar ${s.id} (${s.fluxo} de ${s.solicitante})`,
          instrucao:
            `Trate a solicitação ${s.id} (obter solicitacao --id ${s.id}). Objetivo: ${s.objetivo}. Resultado esperado: ${s.resultadoEsperado}. Prazo: ${s.prazo}.\n` +
            'Termine respondendo a solicitação pela CLI (decisao, conclusao, pedido_informacao ou escalonamento justificado).',
        });
      }
      const ultima = s.respostas[s.respostas.length - 1];
      if (s.status === 'aguardando_informacao' && PAPEIS.includes(s.solicitante)) {
        candidatos.push({
          papel: s.solicitante,
          registro: `${s.id}:informar`,
          versao: s.atualizadoEm,
          titulo: `Complementar informações de ${s.id}`,
          instrucao: `"${s.responsavel}" pediu informações em ${s.id}: ${(ultima && ultima.texto) || ''}. Faltantes: ${s.informacoesFaltantes.join(', ') || '—'}. Busque na CLI e responda com solicitacao responder --tipo informacao. Se a informação não existir na base, diga isso claramente (não invente).`,
        });
      }
      if (s.status === 'aguardando_aprovacao' && ultima && ultima.tipo === 'conclusao' && s.solicitante !== 'humano') {
        candidatos.push({
          papel: s.solicitante,
          registro: `${s.id}:verificar`,
          versao: s.atualizadoEm,
          titulo: `Verificar entrega de ${s.id}`,
          instrucao: `O responsável entregou ${s.id}: "${ultima.texto}". Confira na CLI se o resultado existe e atende ao esperado ("${s.resultadoEsperado}"). Depois use solicitacao verificar --aceitar ou --devolver com a evidência.`,
        });
      }
    }
    for (const t of base.listar('tarefa')) {
      if (['pendente', 'em_andamento'].includes(t.status) && PAPEIS.includes(t.responsavel)) {
        candidatos.push({
          papel: t.responsavel,
          registro: t.id,
          versao: t.atualizadoEm,
          titulo: `Executar ${t.id}: ${t.titulo}`,
          instrucao: `Execute a tarefa ${t.id} ("${t.titulo}", prazo ${t.prazo}). Condição de conclusão: ${t.condicaoConclusao}. Ao terminar, entregue com tarefa mover --status aguardando_aprovacao --evidencia "...".${t.atribuidaPor === t.responsavel ? ' (Tarefa própria: você mesmo pode concluir com evidência.)' : ''}`,
        });
      }
      if (t.status === 'aguardando_aprovacao' && PAPEIS.includes(t.atribuidaPor) && t.atribuidaPor !== t.responsavel) {
        candidatos.push({
          papel: t.atribuidaPor,
          registro: `${t.id}:verificar`,
          versao: t.atualizadoEm,
          titulo: `Verificar ${t.id}`,
          instrucao: `A tarefa ${t.id} foi entregue com a evidência "${t.ultimaEvidencia || ''}". Confira na CLI e conclua (tarefa mover --status concluida --evidencia ...) ou devolva (--status em_andamento).`,
        });
      }
    }

    for (const c of candidatos) {
      const chave = `${c.registro}@${c.versao}`;
      if (this.vistos.has(chave)) continue;
      const kt = `${c.registro}@${hoje}`;
      const n = this.tentativas.get(kt) || 0;
      if (n >= MAX_TENTATIVAS) {
        if (n === MAX_TENTATIVAS) {
          this.eventos.emitir('alerta', { papel: c.papel, texto: `${c.registro} atingiu ${MAX_TENTATIVAS} tentativas hoje; aguardando o responsável humano.` });
          this.tentativas.set(kt, n + 1);
        }
        continue;
      }
      if (this.enfileirar(c.papel, { chave, origem: 'fila', titulo: c.titulo, instrucao: c.instrucao, registro: c.registro })) {
        this.vistos.add(chave);
        this.tentativas.set(kt, n + 1);
      }
    }
  }

  /** Um ciclo: expediente, rotinas, coleta e despacho. */
  tick() {
    const aberto = this.expediente();
    if (aberto !== this.expedienteAnterior) {
      this.eventos.emitir('expediente', { aberto });
      this.expedienteAnterior = aberto;
    }
    if (!aberto) return;
    for (const { rotina, slot } of vencidas(this.agora(), this.cfg, this.executadas, this.rotinas)) {
      this.executadas.add(`${rotina.id}@${slot}`);
      this.enfileirar(rotina.papel, { chave: `rotina:${rotina.id}@${slot}`, origem: 'rotina', titulo: rotina.titulo, instrucao: rotina.instrucao, simulado: rotina.simulado });
    }
    this.salvarEstado();
    try {
      this.coletarDaBase();
    } catch (e) {
      this.eventos.emitir('alerta', { texto: `Falha ao ler a base: ${e.message}` });
    }
    this.despachar();
  }

  podeIniciar(a) {
    if (this.pausadoGeral || a.pausado || !this.expediente()) return false;
    if (this.orcamentoEsgotado()) return false;
    const umaHora = this.agora().getTime() - 3600000;
    a.inicios = a.inicios.filter((t) => t > umaHora);
    if (a.inicios.length >= this.cfg.limites.tarefasPorHoraPorAgente) return false;
    return a.ativos.size < (this.cfg.concorrencia[a.papel] || 1);
  }

  /** Inicia trabalhos sem esperar: agentes trabalham simultaneamente. Retorna as promessas iniciadas. */
  despachar() {
    const iniciados = [];
    for (const a of Object.values(this.agentes)) {
      while (a.fila.length && this.podeIniciar(a)) {
        const job = a.fila.shift();
        a.inicios.push(this.agora().getTime());
        iniciados.push(this.rodar(a, job));
      }
    }
    if (this.orcamentoEsgotado() && Object.values(this.agentes).some((a) => a.fila.length)) {
      this.eventos.emitir('alerta', { texto: 'Orçamento diário de tokens atingido: novos trabalhos aguardam o próximo dia ou ajuste do limite.' });
    }
    return Promise.all(iniciados);
  }

  async rodar(a, job) {
    a.ativos.set(job.id, { ...job, iniciadoEm: this.agora().toISOString() });
    this.eventos.emitir('inicio', { papel: a.papel, job: job.id, titulo: job.titulo, origem: job.origem });
    const ctl = {
      deveParar: () => {
        if (this.pausadoGeral) return 'pausa geral';
        if (a.pausado) return 'agente pausado';
        if (!this.expediente()) return 'fim do expediente';
        if (this.orcamentoEsgotado()) return 'orçamento diário de tokens atingido';
        return null;
      },
      registrarTokens: (n) => this.registrarTokens(n),
      evento: (tipo, dados) => this.eventos.emitir(tipo, { papel: a.papel, job: job.id, ...dados }),
    };
    let resultado;
    try {
      resultado = await this.executarJob(a.papel, job, ctl);
    } catch (e) {
      resultado = { status: 'erro', resumo: e.message, tokens: 0 };
    }
    a.ativos.delete(job.id);
    if (resultado.status === 'erro') a.erros++;
    else a.concluidos++;
    a.ultimo = { job: job.id, titulo: job.titulo, status: resultado.status, resumo: resultado.resumo, em: this.agora().toISOString() };
    this.historico.unshift({ papel: a.papel, ...a.ultimo, tokens: resultado.tokens });
    this.historico = this.historico.slice(0, 100);
    this.eventos.emitir('fim', { papel: a.papel, job: job.id, titulo: job.titulo, status: resultado.status, resumo: resultado.resumo, tokens: resultado.tokens });
    // A conclusão pode ter liberado trabalho para outro agente: coleta e despacha de novo.
    try {
      this.coletarDaBase();
    } catch {
      // a próxima rodada do tick tenta de novo
    }
    await this.despachar();
    return resultado;
  }

  // ------------------------------------------------------------ controle

  pausar(papel) {
    if (papel) this.agentes[papel].pausado = true;
    else this.pausadoGeral = true;
    this.eventos.emitir('pausa', { papel: papel || 'todos', pausado: true });
  }

  retomar(papel) {
    if (papel) this.agentes[papel].pausado = false;
    else this.pausadoGeral = false;
    this.eventos.emitir('pausa', { papel: papel || 'todos', pausado: false });
    this.despachar();
  }

  /** Execução manual de uma rotina pelo painel (respeita pausa e expediente). */
  executarRotina(id) {
    const r = this.rotinas.find((x) => x.id === id);
    if (!r) return null;
    return this.enfileirar(r.papel, { chave: `manual:${id}@${Date.now()}`, origem: 'manual', titulo: r.titulo, instrucao: r.instrucao, simulado: r.simulado });
  }

  estado() {
    return {
      modo: this.cfg.modo,
      base: this.cfg.base,
      expediente: { aberto: this.expediente(), ...this.cfg.expediente, fuso: this.cfg.fuso },
      pausadoGeral: this.pausadoGeral,
      tokens: { hoje: this.tokens.data === this.dataLocal() ? this.tokens.total : 0, limite: this.cfg.limites.tokensPorDia },
      agentes: Object.values(this.agentes).map((a) => ({
        papel: a.papel,
        pausado: a.pausado,
        concorrencia: this.cfg.concorrencia[a.papel] || 1,
        ativos: [...a.ativos.values()].map((j) => ({ id: j.id, titulo: j.titulo, origem: j.origem, iniciadoEm: j.iniciadoEm })),
        fila: a.fila.map((j) => ({ id: j.id, titulo: j.titulo, origem: j.origem })),
        concluidos: a.concluidos,
        erros: a.erros,
        ultimo: a.ultimo,
      })),
      rotinas: this.rotinas.map((r) => ({ id: r.id, papel: r.papel, titulo: r.titulo, quando: r.hora ? `${r.hora}${r.dias ? ` (dias ${r.dias.join(',')})` : ''}` : `a cada ${r.aCadaMin} min` })),
      historico: this.historico.slice(0, 30),
    };
  }

  iniciar() {
    this.carregarEstado();
    this.eventos.emitir('servico', { texto: `Serviço iniciado (modo ${this.cfg.modo}, base ${this.cfg.base}).` });
    this.tick();
    this.timer = setInterval(() => this.tick(), this.cfg.intervaloTickMs);
  }

  parar() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Orquestrador, MAX_TENTATIVAS };
