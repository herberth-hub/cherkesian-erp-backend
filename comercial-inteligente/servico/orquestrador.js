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
  constructor({ cfg, executarJob, eventos, agora = () => new Date(), rotinas = ROTINAS, leitorEmail = null, whatsapp = null, sincronizacao = null }) {
    this.cfg = cfg;
    this.sincronizacao = sincronizacao;
    this.leitorEmail = leitorEmail;
    this.whatsapp = whatsapp;
    this.falhasWhatsapp = new Map(); // telefone -> { n, ate } (falhas seguidas desde a última mensagem)
    if (whatsapp) whatsapp.aoReceber = (telefone) => this.enfileirarWhatsapp(telefone);
    this.emailVerificadoEm = 0;
    this.verificandoEmail = null;
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

  registrarTokens(n, usd = 0) {
    const hoje = this.dataLocal();
    if (this.tokens.data !== hoje) this.tokens = { data: hoje, total: 0, usd: 0 };
    this.tokens.total += n;
    this.tokens.usd = (this.tokens.usd || 0) + usd;
  }

  orcamentoEsgotado() {
    if (this.tokens.data !== this.dataLocal()) return false;
    return this.tokens.total >= this.cfg.limites.tokensPorDia || (this.tokens.usd || 0) >= (this.cfg.limites.usdPorDia || Infinity);
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
      if (this.enfileirar(c.papel, { chave, origem: 'fila', titulo: c.titulo, instrucao: c.instrucao, registro: c.registro, ...this.enxuto() })) {
        this.vistos.add(chave);
        this.tentativas.set(kt, n + 1);
      }
    }
  }

  /**
   * Verifica as caixas de e-mail (fase 2) se já passou o intervalo. Só no modo claude:
   * triagem de e-mail exige julgamento. Devolve a promessa da verificação (útil nos testes).
   */
  verificarEmail() {
    if (!this.leitorEmail || this.cfg.modo !== 'claude' || this.verificandoEmail) return this.verificandoEmail;
    const intervalo = this.leitorEmail.email.intervaloMin * 60000;
    if (this.agora().getTime() - this.emailVerificadoEm < intervalo) return null;
    this.emailVerificadoEm = this.agora().getTime();
    this.verificandoEmail = this.leitorEmail
      .verificar()
      .then((trabalhos) => {
        for (const t of trabalhos) {
          if (!this.enfileirar('vendedor', { ...t, ...this.enxuto() })) this.leitorEmail.emFila.delete(t.chave.replace(/^email:/, ''));
        }
        if (trabalhos.length) this.eventos.emitir('email', { papel: 'vendedor', texto: `${trabalhos.length} e-mail(s) novo(s) para triagem.` });
        return this.despachar();
      })
      .catch((e) => this.eventos.emitir('alerta', { papel: 'vendedor', texto: `Falha ao verificar e-mails: ${e.message}` }))
      .finally(() => {
        this.verificandoEmail = null;
      });
    return this.verificandoEmail;
  }

  /**
   * Conversa de WhatsApp com mensagem nova vira trabalho do vendedor (uma por telefone por vez).
   * A instrução é montada na hora em que o trabalho começa; ao terminar, se o cliente escreveu
   * de novo nesse meio-tempo, a conversa volta para a fila.
   */
  enfileirarWhatsapp(telefone) {
    const w = this.whatsapp;
    if (!w || this.cfg.modo !== 'claude' || !w.precisaAgente(telefone)) return null;
    const c = w.conversa(telefone);
    const f = this.falhasWhatsapp.get(c.telefone);
    if (f && f.n >= 3 && f.ate === c.nCliente) return null; // aguarda mensagem nova ou ação humana
    const job = this.enfileirar('vendedor', {
      chave: `whatsapp:${c.telefone}`,
      origem: 'whatsapp',
      titulo: `WhatsApp: ${c.nome || `•••${c.telefone.slice(-4)}`}`,
      whatsapp: { telefone: c.telefone },
      instrucao: () => {
        job.vistoAte = w.conversa(telefone).nCliente || 0;
        return w.instrucao(telefone);
      },
      aoConcluir: (resultado) => {
        // Só conta como lida se o agente terminou; interrompido/erro volta para a fila.
        if (resultado && resultado.status === 'concluido') {
          w.marcarVisto(telefone, job.vistoAte);
          this.falhasWhatsapp.delete(c.telefone);
        } else {
          const ate = job.vistoAte === undefined ? w.conversa(telefone).nCliente || 0 : job.vistoAte;
          const ant = this.falhasWhatsapp.get(c.telefone);
          const n = ant && ant.ate === ate ? ant.n + 1 : 1;
          this.falhasWhatsapp.set(c.telefone, { n, ate });
          if (n === 3) this.eventos.emitir('alerta', { papel: 'vendedor', texto: `WhatsApp ${c.nome || `•••${c.telefone.slice(-4)}`}: 3 tentativas sem sucesso; responda pelo painel.` });
        }
        if (w.precisaAgente(telefone)) setImmediate(() => this.enfileirarWhatsapp(telefone));
      },
    });
    if (job) this.despachar();
    return job;
  }

  /** Trabalhos de rotina (rotinas, e-mails, tarefas entre agentes): raciocínio enxuto e o modelo de rotina. */
  enxuto() {
    return { esforco: this.cfg.esforcoRotina, modelo: this.cfg.modeloRotina };
  }

  /** Um ciclo: expediente, rotinas, coleta e despacho. */
  tick() {
    // Importação diária do ERP: roda no horário dela (antes da abertura), mesmo fora do expediente dos agentes.
    if (this.sincronizacao && this.sincronizacao.devidaAgora()) {
      this.sincronizacao.executar('automatica').catch((e) => this.eventos.emitir('alerta', { texto: `Importação do ERP: ${e.message}` }));
    }
    const aberto = this.expediente();
    if (aberto !== this.expedienteAnterior) {
      this.eventos.emitir('expediente', { aberto });
      this.expedienteAnterior = aberto;
    }
    if (!aberto) return;
    for (const { rotina, slot } of vencidas(this.agora(), this.cfg, this.executadas, this.rotinas)) {
      this.executadas.add(`${rotina.id}@${slot}`);
      this.enfileirar(rotina.papel, { chave: `rotina:${rotina.id}@${slot}`, origem: 'rotina', titulo: rotina.titulo, instrucao: rotina.instrucao, simulado: rotina.simulado, ...this.enxuto() });
    }
    this.salvarEstado();
    this.verificarEmail();
    if (this.whatsapp) for (const t of this.whatsapp.pendentes()) this.enfileirarWhatsapp(t);
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
      this.eventos.emitir('alerta', { texto: 'Orçamento diário atingido (US$ ou tokens): novos trabalhos aguardam o próximo dia ou ajuste do limite.' });
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
        if (this.orcamentoEsgotado()) return 'orçamento diário atingido';
        return null;
      },
      registrarTokens: (n, usd) => this.registrarTokens(n, usd),
      evento: (tipo, dados) => this.eventos.emitir(tipo, { papel: a.papel, job: job.id, ...dados }),
    };
    let resultado;
    try {
      resultado = await this.executarJob(a.papel, job, ctl);
    } catch (e) {
      resultado = { status: 'erro', resumo: e.message, tokens: 0 };
    }
    a.ativos.delete(job.id);
    if (typeof job.aoConcluir === 'function') {
      try {
        job.aoConcluir(resultado);
      } catch (e) {
        this.eventos.emitir('alerta', { papel: a.papel, texto: `Falha ao registrar conclusão de ${job.id}: ${e.message}` });
      }
    }
    if (resultado.status === 'erro') a.erros++;
    else a.concluidos++;
    a.ultimo = { job: job.id, titulo: job.titulo, status: resultado.status, resumo: resultado.resumo, em: this.agora().toISOString() };
    this.historico.unshift({ papel: a.papel, ...a.ultimo, tokens: resultado.tokens, usd: resultado.usd });
    this.historico = this.historico.slice(0, 100);
    this.eventos.emitir('fim', { papel: a.papel, job: job.id, titulo: job.titulo, status: resultado.status, resumo: resultado.resumo, tokens: resultado.tokens, usd: resultado.usd });
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
    return this.enfileirar(r.papel, { chave: `manual:${id}@${Date.now()}`, origem: 'manual', titulo: r.titulo, instrucao: r.instrucao, simulado: r.simulado, ...this.enxuto() });
  }

  estado() {
    return {
      modo: this.cfg.modo,
      base: this.cfg.base,
      expediente: { aberto: this.expediente(), ...this.cfg.expediente, fuso: this.cfg.fuso },
      pausadoGeral: this.pausadoGeral,
      tokens: {
        hoje: this.tokens.data === this.dataLocal() ? this.tokens.total : 0,
        limite: this.cfg.limites.tokensPorDia,
        usdHoje: this.tokens.data === this.dataLocal() ? Math.round((this.tokens.usd || 0) * 100) / 100 : 0,
        usdLimite: this.cfg.limites.usdPorDia || null,
      },
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
      email: this.leitorEmail ? this.leitorEmail.estado() : null,
      whatsapp: this.whatsapp ? this.whatsapp.estado() : null,
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
