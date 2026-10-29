'use strict';

/**
 * Base de dados em arquivos JSON (uma coleção por entidade).
 * - valida todo registro contra o schema antes de gravar;
 * - impede misturar dados fictícios (base demo) com dados reais (base produção);
 * - verifica duplicidade antes de criar;
 * - grava histórico de alterações;
 * - escrita atômica (arquivo temporário + rename).
 * Interface pensada para ser trocada por um repositório de banco/CRM no futuro
 * (mesmos métodos: listar, obter, criar, atualizar).
 */

const fs = require('fs');
const path = require('path');
const { validar } = require('./validador');
const { SCHEMAS, PREFIXOS, COLECOES } = require('./schemas');
const { ErroNegocio } = require('./erros');
const { ETAPAS_ABERTAS } = require('./dominio');

const RAIZ = path.resolve(__dirname, '..');
const DIR_DADOS = path.join(RAIZ, 'data');

/** Normaliza nomes para comparação: sem acento, caixa, pontuação e sufixos societários. */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|s\/?a|me|epp|eireli|ficticio|ficticia)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

class Base {
  /**
   * @param {object} o
   * @param {string} o.dir      diretório da base
   * @param {boolean} o.ficticia true = base de demonstração (só aceita registros fictícios)
   */
  constructor({ dir, ficticia }) {
    this.dir = dir;
    this.ficticia = ficticia;
    this.cache = {};
  }

  /** Abre a base: HC_DATA_DIR (testes/integrações) > data/<nome>. A demo nasce da semente versionada. */
  static abrir({ nome = process.env.HC_BASE || 'producao', dir = process.env.HC_DATA_DIR } = {}) {
    if (!['producao', 'demo'].includes(nome)) throw new ErroNegocio('BASE_INVALIDA', `Base "${nome}" inválida (use producao ou demo).`);
    const ficticia = nome === 'demo';
    const alvo = dir || path.join(DIR_DADOS, nome);
    if (ficticia && !fs.existsSync(path.join(alvo, 'agentes.json'))) Base.restaurarDemo(alvo);
    fs.mkdirSync(alvo, { recursive: true });
    return new Base({ dir: alvo, ficticia });
  }

  static restaurarDemo(alvo = path.join(DIR_DADOS, 'demo')) {
    const semente = path.join(DIR_DADOS, 'demo-seed');
    fs.rmSync(alvo, { recursive: true, force: true });
    fs.mkdirSync(alvo, { recursive: true });
    for (const f of fs.readdirSync(semente)) {
      if (f.endsWith('.json')) fs.copyFileSync(path.join(semente, f), path.join(alvo, f));
    }
    return alvo;
  }

  arquivo(entidade) {
    if (!COLECOES[entidade]) throw new ErroNegocio('ENTIDADE_INVALIDA', `Entidade desconhecida: ${entidade}.`);
    return path.join(this.dir, `${COLECOES[entidade]}.json`);
  }

  listar(entidade) {
    if (this.cache[entidade]) return this.cache[entidade];
    const f = this.arquivo(entidade);
    let lista = [];
    if (fs.existsSync(f)) {
      try {
        lista = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        throw new ErroNegocio('ARQUIVO_CORROMPIDO', `Não foi possível ler ${f}: ${e.message}`);
      }
      if (!Array.isArray(lista)) throw new ErroNegocio('ARQUIVO_CORROMPIDO', `${f} deveria conter uma lista.`);
    }
    this.cache[entidade] = lista;
    return lista;
  }

  gravar(entidade, lista) {
    const f = this.arquivo(entidade);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lista, null, 2) + '\n');
    fs.renameSync(tmp, f);
    this.cache[entidade] = lista;
  }

  obter(entidade, id) {
    return this.listar(entidade).find((r) => r.id === id) || null;
  }

  exigir(entidade, id) {
    const r = this.obter(entidade, id);
    if (!r) throw new ErroNegocio('NAO_ENCONTRADO', `${entidade} ${id} não encontrado(a).`);
    return r;
  }

  proximoId(entidade) {
    const prefixo = PREFIXOS[entidade];
    const max = this.listar(entidade).reduce((m, r) => {
      const n = Number(String(r.id).split('-')[1]);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return `${prefixo}-${String(max + 1).padStart(4, '0')}`;
  }

  /** Valida schema + integridade referencial. Lança ErroNegocio com a lista de problemas. */
  validarRegistro(entidade, reg) {
    const erros = validar(SCHEMAS[entidade], reg);
    if (reg.ficticio !== this.ficticia) {
      erros.push(
        this.ficticia
          ? 'Base de demonstração aceita apenas registros com ficticio=true.'
          : 'Base de produção não aceita registros fictícios (ficticio=true).',
      );
    }
    for (const [campo, alvo] of [
      ['clienteId', 'cliente'],
      ['leadId', 'lead'],
      ['oportunidadeId', 'oportunidade'],
      ['propostaId', 'proposta'],
      ['responsavelId', 'agente'],
      ['metaPaiId', 'meta'],
    ]) {
      if (reg[campo] && !this.obter(alvo, reg[campo])) erros.push(`$.${campo}: ${alvo} ${reg[campo]} não existe.`);
    }
    if (entidade === 'proposta') {
      (reg.itens || []).forEach((it, i) => {
        if (it.produtoId && !this.obter('produto', it.produtoId)) erros.push(`$.itens[${i}].produtoId: produto ${it.produtoId} não existe.`);
      });
    }
    if (erros.length) throw new ErroNegocio('VALIDACAO', `Registro de ${entidade} inválido:\n- ${erros.join('\n- ')}`, erros);
  }

  /** Procura registro equivalente já existente (evita duplicar clientes, leads e oportunidades). */
  duplicado(entidade, reg) {
    const lista = this.listar(entidade);
    if (reg.erpId) {
      const porErp = lista.find((r) => r.erpId && r.erpId === reg.erpId);
      if (porErp) return porErp;
    }
    if (entidade === 'cliente' || entidade === 'lead') {
      const nome = normalizar(reg.razaoSocial || reg.empresa);
      const cnpj = soDigitos(reg.cnpj);
      const cand = (r) => (cnpj && soDigitos(r.cnpj) === cnpj) || (nome && normalizar(r.razaoSocial || r.empresa) === nome);
      return lista.find(cand) || null;
    }
    if (entidade === 'oportunidade') {
      return (
        lista.find(
          (r) =>
            ETAPAS_ABERTAS.includes(r.etapa) &&
            ((reg.clienteId && r.clienteId === reg.clienteId) || (reg.leadId && r.leadId === reg.leadId)) &&
            normalizar(r.titulo) === normalizar(reg.titulo),
        ) || null
      );
    }
    if (entidade === 'contato' && reg.email) {
      return lista.find((r) => r.clienteId === reg.clienteId && String(r.email || '').toLowerCase() === reg.email.toLowerCase()) || null;
    }
    return null;
  }

  criar(entidade, dados, agente, { origem = 'agente' } = {}) {
    const agora = new Date().toISOString();
    const reg = {
      ...dados,
      id: this.proximoId(entidade),
      ficticio: dados.ficticio !== undefined ? dados.ficticio : this.ficticia,
      origem: dados.origem || (agente === 'humano' && origem === 'agente' ? 'manual' : origem),
      criadoEm: agora,
      atualizadoEm: agora,
      criadoPor: agente,
    };
    const dup = this.duplicado(entidade, reg);
    if (dup) {
      throw new ErroNegocio('DUPLICADO', `Já existe ${entidade} equivalente: ${dup.id}. Atualize o registro existente em vez de duplicar.`, { existente: dup.id });
    }
    this.validarRegistro(entidade, reg);
    this.gravar(entidade, [...this.listar(entidade), reg]);
    this.registrarHistorico(entidade, reg.id, 'criar', agente, null, reg);
    return reg;
  }

  atualizar(entidade, id, patch, agente, { acao = 'atualizar' } = {}) {
    const atual = this.exigir(entidade, id);
    const proibidos = ['id', 'criadoEm', 'criadoPor', 'ficticio'].filter((k) => k in patch && patch[k] !== atual[k]);
    if (proibidos.length) throw new ErroNegocio('CAMPO_PROTEGIDO', `Campos não podem ser alterados: ${proibidos.join(', ')}.`);
    const novo = { ...atual, ...patch, atualizadoEm: new Date().toISOString() };
    this.validarRegistro(entidade, novo);
    this.gravar(
      entidade,
      this.listar(entidade).map((r) => (r.id === id ? novo : r)),
    );
    const antes = {};
    const depois = {};
    for (const k of Object.keys(patch)) {
      antes[k] = atual[k] === undefined ? null : atual[k];
      depois[k] = novo[k];
    }
    this.registrarHistorico(entidade, id, acao, agente, antes, depois);
    return novo;
  }

  registrarHistorico(entidade, registroId, acao, agente, antes, depois) {
    if (entidade === 'historico') return;
    const reg = {
      id: this.proximoId('historico'),
      ficticio: this.ficticia,
      criadoEm: new Date().toISOString(),
      entidade,
      registroId,
      acao,
      agente,
      antes,
      depois,
    };
    this.gravar('historico', [...this.listar('historico'), reg]);
  }

  /** Política comercial efetiva: arquivo da base (definido pelo humano) ou o modelo não configurado. */
  politica() {
    const local = path.join(this.dir, 'politica_comercial.json');
    const f = fs.existsSync(local) ? local : path.join(RAIZ, 'config', 'politica_comercial.json');
    return { ...JSON.parse(fs.readFileSync(f, 'utf8')), _arquivo: path.relative(RAIZ, f) };
  }

  premissas() {
    const local = path.join(this.dir, 'premissas.json');
    const f = fs.existsSync(local) ? local : path.join(RAIZ, 'config', 'premissas.json');
    return { ...JSON.parse(fs.readFileSync(f, 'utf8')), _arquivo: path.relative(RAIZ, f) };
  }

  /** Validação completa da base (schemas + referências). Retorna lista de problemas. */
  auditar() {
    const problemas = [];
    for (const entidade of Object.keys(COLECOES)) {
      for (const reg of this.listar(entidade)) {
        try {
          this.validarRegistro(entidade, reg);
        } catch (e) {
          problemas.push({ entidade, id: reg.id, erros: e.detalhes || [e.message] });
        }
      }
    }
    return problemas;
  }
}

module.exports = { Base, normalizar, soDigitos, RAIZ, DIR_DADOS };
