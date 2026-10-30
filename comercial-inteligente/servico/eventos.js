'use strict';

/**
 * Barramento de eventos do serviço: alimenta o painel (SSE) e o arquivo
 * logs/atividade.jsonl. Mantém os últimos eventos em memória para quem chega.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { ocultar } = require('../src/log');

class Eventos extends EventEmitter {
  constructor({ dir, capacidade = 500 } = {}) {
    super();
    this.setMaxListeners(100);
    this.dir = dir;
    this.capacidade = capacidade;
    this.recentes = [];
    this.seq = 0;
  }

  emitir(tipo, dados = {}) {
    const ev = ocultar({ seq: ++this.seq, em: new Date().toISOString(), tipo, ...dados });
    this.recentes.push(ev);
    if (this.recentes.length > this.capacidade) this.recentes.shift();
    if (this.dir) {
      try {
        fs.mkdirSync(path.join(this.dir, 'logs'), { recursive: true });
        fs.appendFileSync(path.join(this.dir, 'logs', 'atividade.jsonl'), JSON.stringify(ev) + '\n');
      } catch {
        // log em disco é auxiliar; o evento segue para o painel
      }
    }
    this.emit('evento', ev);
    return ev;
  }
}

module.exports = { Eventos };
