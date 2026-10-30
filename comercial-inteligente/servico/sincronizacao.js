'use strict';

/**
 * Importação automática diária do ERP (somente leitura).
 * Nos dias configurados, a partir do horário (padrão 06:00, antes da abertura dos agentes),
 * importa clientes → produtos → pedidos → leads uma vez por dia. Também roda sob demanda
 * ("Sincronizar agora" no painel). Leads usam o último vendedor responsável escolhido.
 * Sem IA: não consome tokens.
 */

const fs = require('fs');
const path = require('path');
const { local, paraMinutos } = require('./horario');

const RECURSOS = ['clientes', 'produtos', 'pedidos', 'leads'];

function configSincronizacao(env = process.env, expediente = { dias: [1, 2, 3, 4, 5] }) {
  return {
    ativa: env.HC_ERP_SYNC !== 'off',
    hora: /^\d{2}:\d{2}$/.test(env.HC_ERP_SYNC_HORA || '') ? env.HC_ERP_SYNC_HORA : '06:00',
    dias: env.HC_ERP_SYNC_DIAS ? String(env.HC_ERP_SYNC_DIAS).split(',').map(Number) : expediente.dias,
  };
}

class SincronizacaoErp {
  /**
   * @param {object} o
   * @param {() => import('../src/store').Base} o.abrirBase
   * @param {Function} [o.importar] integracoes/erp.importar (injetável nos testes)
   * @param {object} [o.erpCliente] cliente HTTP do ERP (testes)
   */
  constructor({ cfg, dir, eventos, abrirBase, importar, erpCliente = null, env = process.env, agora = () => new Date() }) {
    this.cfg = cfg;
    this.sync = configSincronizacao(env, cfg.expediente);
    this.env = env;
    this.eventos = eventos;
    this.abrirBase = abrirBase;
    this.importar = importar || require('../integracoes/erp').importar;
    this.erpCliente = erpCliente;
    this.agora = agora;
    this.arquivo = path.join(dir, 'erp-sincronizacao.json');
    this.emAndamento = null;
    this.dados = this.ler();
  }

  ler() {
    try {
      return JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
    } catch {
      return { ultimaData: null, ultima: null, responsavelLeads: null };
    }
  }

  salvar() {
    fs.writeFileSync(this.arquivo, JSON.stringify(this.dados, null, 2));
  }

  erpConfigurado() {
    return Boolean(this.env.ERP_API_URL && this.env.ERP_USUARIO && this.env.ERP_SENHA) || Boolean(this.erpCliente);
  }

  /** Lembra o vendedor responsável pelos leads (o último escolhido na importação manual). */
  definirResponsavel(id) {
    if (!id) return;
    this.dados.responsavelLeads = id;
    this.salvar();
  }

  /** Hoje é dia de sincronizar, já passou do horário e ainda não rodou hoje? */
  devidaAgora() {
    if (!this.sync.ativa || !this.erpConfigurado()) return false;
    const l = local(this.agora(), this.cfg.fuso);
    return this.sync.dias.includes(l.diaSemana) && l.minutos >= paraMinutos(this.sync.hora) && this.dados.ultimaData !== l.data;
  }

  /** Executa a sequência completa. Concorrência: uma por vez (chamadas simultâneas recebem a mesma promessa). */
  executar(origem = 'automatica') {
    if (this.emAndamento) return this.emAndamento;
    this.emAndamento = this.rodar(origem).finally(() => {
      this.emAndamento = null;
    });
    return this.emAndamento;
  }

  async rodar(origem) {
    const base = this.abrirBase();
    const hoje = local(this.agora(), this.cfg.fuso).data;
    const inicio = this.agora().toISOString();
    if (base.ficticia) throw Object.assign(new Error('A importação do ERP só funciona na base de produção (HC_BASE=producao).'), { status: 422 });
    this.eventos.emitir('erp', { texto: `Importação do ERP iniciada (${origem}).` });
    const resultados = [];
    let falhaGeral = null;
    for (const recurso of RECURSOS) {
      if (recurso === 'leads' && !this.dados.responsavelLeads) {
        resultados.push({ recurso, pulado: 'sem vendedor responsável definido (importe os leads manualmente uma vez escolhendo o vendedor)' });
        continue;
      }
      try {
        const r = await this.importar(base, recurso, { responsavelPadraoId: this.dados.responsavelLeads || undefined, cliente: this.erpCliente || undefined });
        resultados.push({ recurso, criados: r.criados, atualizados: r.atualizados, ignorados: r.ignorados, erros: r.erros.length, exemplosErro: r.erros.slice(0, 3) });
      } catch (e) {
        resultados.push({ recurso, falha: e.message });
        // Sem conexão/credencial não adianta seguir para os outros recursos.
        if (recurso === 'clientes') {
          falhaGeral = e.message;
          break;
        }
      }
    }
    const ok = !falhaGeral && !resultados.some((r) => r.falha);
    this.dados.ultima = { origem, inicio, fim: this.agora().toISOString(), ok, resultados, falhaGeral };
    // Marca o dia mesmo com falha: evita martelar o ERP; o painel mostra o erro e o botão permite repetir.
    if (origem === 'automatica') this.dados.ultimaData = hoje;
    this.salvar();
    const resumo = resultados.map((r) => (r.pulado ? `${r.recurso}: pulado` : r.falha ? `${r.recurso}: FALHA` : `${r.recurso}: ${r.criados} novos/${r.atualizados} atualizados${r.erros ? `/${r.erros} erros` : ''}`)).join(' · ');
    this.eventos.emitir(ok ? 'erp' : 'alerta', { texto: `Importação do ERP ${ok ? 'concluída' : 'com problemas'}: ${resumo}` });
    return this.dados.ultima;
  }

  estado() {
    return {
      ativa: this.sync.ativa,
      hora: this.sync.hora,
      dias: this.sync.dias,
      responsavelLeads: this.dados.responsavelLeads || null,
      emAndamento: Boolean(this.emAndamento),
      ultima: this.dados.ultima || null,
    };
  }
}

module.exports = { SincronizacaoErp, configSincronizacao, RECURSOS };
