'use strict';

/**
 * Configuração do serviço autônomo, só por variáveis de ambiente (segredos nunca no código).
 */

const PAPEIS = ['ceo', 'diretor', 'gerente', 'vendedor'];

/** Preço por milhão de tokens (US$). Padrão: Claude Opus 5.5 — confira em anthropic.com/pricing. */
function precos(env) {
  const n = (v, padrao) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : padrao);
  return {
    entrada: n(env.HC_PRECO_ENTRADA, 4),
    saida: n(env.HC_PRECO_SAIDA, 20),
    cacheLeitura: n(env.HC_PRECO_CACHE_LEITURA, 0.2),
    cacheEscrita: n(env.HC_PRECO_CACHE_ESCRITA, 5),
  };
}

function inteiro(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : padrao;
}

function carregar(env = process.env) {
  const modo = env.HC_MODO || (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'simulado');
  if (!['claude', 'simulado'].includes(modo)) throw new Error('HC_MODO deve ser "claude" ou "simulado".');
  const [abre, fecha] = String(env.HC_HORARIO || '06:30-22:00').split('-');
  return {
    modo,
    base: env.HC_BASE || 'producao',
    dataDir: env.HC_DATA_DIR || undefined,
    porta: inteiro(env.PORT || env.HC_PORTA, 3100),
    painelToken: env.PAINEL_TOKEN || null,
    fuso: env.HC_FUSO || 'America/Sao_Paulo',
    expediente: { abre, fecha, dias: String(env.HC_DIAS || '1,2,3,4,5').split(',').map(Number) },
    modelo: env.HC_MODELO || 'claude-opus-5-5',
    esforco: env.HC_ESFORCO || 'medium',
    // Rotinas são leituras e resumos padronizados: raciocínio mais enxuto (mais barato).
    esforcoRotina: env.HC_ESFORCO_ROTINA || 'low',
    precos: precos(env),
    fallbacks: env.HC_FALLBACKS !== 'off',
    limites: {
      iteracoesPorTarefa: inteiro(env.HC_MAX_ITERACOES, 12),
      tarefasPorHoraPorAgente: inteiro(env.HC_MAX_TAREFAS_HORA, 20),
      tokensPorDia: inteiro(env.HC_ORCAMENTO_TOKENS_DIA, 3000000),
      // Teto principal: custo estimado do dia em US$ (cache lido custa ~10% da entrada).
      usdPorDia: Number(env.HC_ORCAMENTO_USD_DIA) > 0 ? Number(env.HC_ORCAMENTO_USD_DIA) : 5,
    },
    concorrencia: {
      ceo: inteiro(env.HC_PARALELO_CEO, 1),
      diretor: inteiro(env.HC_PARALELO_DIRETOR, 1),
      gerente: inteiro(env.HC_PARALELO_GERENTE, 1),
      vendedor: inteiro(env.HC_PARALELO_VENDEDOR, 3),
    },
    intervaloTickMs: inteiro(env.HC_TICK_MS, 30000),
  };
}

module.exports = { carregar, PAPEIS };
