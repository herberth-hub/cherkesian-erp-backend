'use strict';

/**
 * Configuração do serviço autônomo, só por variáveis de ambiente (segredos nunca no código).
 */

const PAPEIS = ['ceo', 'diretor', 'gerente', 'vendedor', 'hunter'];

/** Preço por milhão de tokens (US$) por modelo — confira em anthropic.com/pricing. */
const TABELA_PRECOS = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
};

/** Preços do modelo principal; HC_PRECO_* sobrescrevem (modelo fora da tabela usa os do Opus 5.5). */
function precos(env, modelo = 'claude-opus-5-5') {
  const n = (v, padrao) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : padrao);
  const base = TABELA_PRECOS[modelo] || TABELA_PRECOS['claude-opus-5-5'];
  return {
    entrada: n(env.HC_PRECO_ENTRADA, base.entrada),
    saida: n(env.HC_PRECO_SAIDA, base.saida),
    cacheLeitura: n(env.HC_PRECO_CACHE_LEITURA, base.cacheLeitura),
    cacheEscrita: n(env.HC_PRECO_CACHE_ESCRITA, base.cacheEscrita),
  };
}

/** Preços de um modelo qualquer: tabela, ou os do modelo principal se não estiver nela. */
function precosDe(cfg, modelo) {
  return modelo && modelo !== cfg.modelo && TABELA_PRECOS[modelo] ? TABELA_PRECOS[modelo] : cfg.precos;
}

function inteiro(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : padrao;
}

function carregar(env = process.env) {
  const modo = env.HC_MODO || (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'simulado');
  if (!['claude', 'simulado'].includes(modo)) throw new Error('HC_MODO deve ser "claude" ou "simulado".');
  const [abre, fecha] = String(env.HC_HORARIO || '06:30-22:00').split('-');
  const modelo = env.HC_MODELO || 'claude-opus-5-5';
  return {
    modo,
    base: env.HC_BASE || 'producao',
    dataDir: env.HC_DATA_DIR || undefined,
    porta: inteiro(env.PORT || env.HC_PORTA, 3100),
    painelToken: env.PAINEL_TOKEN || null,
    fuso: env.HC_FUSO || 'America/Sao_Paulo',
    expediente: { abre, fecha, dias: String(env.HC_DIAS || '1,2,3,4,5').split(',').map(Number) },
    modelo,
    // Modelo dos trabalhos de rotina: rotinas, e-mails e tarefas entre agentes (padrão: o mesmo modelo principal).
    // Ex.: HC_MODELO_ROTINA=claude-sonnet-5-5 custa metade do Opus 5.5. WhatsApp com cliente usa sempre o principal.
    modeloRotina: env.HC_MODELO_ROTINA || modelo,
    esforco: env.HC_ESFORCO || 'medium',
    // Rotinas são leituras e resumos padronizados: raciocínio mais enxuto (mais barato).
    esforcoRotina: env.HC_ESFORCO_ROTINA || 'low',
    precos: precos(env, modelo),
    fallbacks: env.HC_FALLBACKS !== 'off',
    limites: {
      iteracoesPorTarefa: inteiro(env.HC_MAX_ITERACOES, 8),
      tarefasPorHoraPorAgente: inteiro(env.HC_MAX_TAREFAS_HORA, 10),
      tokensPorDia: inteiro(env.HC_ORCAMENTO_TOKENS_DIA, 3000000),
      // Teto principal: custo estimado do dia em US$ (cache lido custa ~10% da entrada).
      usdPorDia: Number(env.HC_ORCAMENTO_USD_DIA) > 0 ? Number(env.HC_ORCAMENTO_USD_DIA) : 5,
    },
    concorrencia: {
      ceo: inteiro(env.HC_PARALELO_CEO, 1),
      diretor: inteiro(env.HC_PARALELO_DIRETOR, 1),
      gerente: inteiro(env.HC_PARALELO_GERENTE, 1),
      vendedor: inteiro(env.HC_PARALELO_VENDEDOR, 3),
      hunter: inteiro(env.HC_PARALELO_HUNTER, 1),
    },
    // Hunter (pesquisa web de grandes contas): HC_HUNTER=off desliga; buscas por trabalho limitadas.
    hunter: { ativo: env.HC_HUNTER !== 'off', buscasPorTrabalho: inteiro(env.HC_HUNTER_BUSCAS, 8), paginasPorTrabalho: inteiro(env.HC_HUNTER_PAGINAS, 6) },
    intervaloTickMs: inteiro(env.HC_TICK_MS, 30000),
  };
}

module.exports = { carregar, precosDe, TABELA_PRECOS, PAPEIS };
