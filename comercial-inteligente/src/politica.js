'use strict';

/**
 * Política comercial definida pelo responsável humano (painel ou CLI).
 * Valida tipos e a coerência da hierarquia antes de gravar:
 *  - desconto máximo cresce com o nível (vendedor ≤ gerente ≤ diretor ≤ CEO);
 *  - margem mínima de cada alçada diminui com o nível, e nenhuma fica abaixo da mínima global;
 *  - valor máximo cresce com o nível (vazio = sem limite).
 */

const fs = require('fs');
const path = require('path');
const { ErroNegocio } = require('./erros');

const NIVEIS = ['vendedor', 'gerente', 'diretor', 'ceo'];
const ROTULO = { vendedor: 'Vendedor', gerente: 'Gerente', diretor: 'Diretor', ceo: 'CEO' };

function numero(v, campo, erros, { max = null } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (max !== null && n > max)) {
    erros.push(`${campo}: informe um número${max !== null ? ` entre 0 e ${max}` : ' maior ou igual a 0'}.`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

/** Normaliza e valida. Devolve a política pronta para gravar ou lança ErroNegocio com a lista de problemas. */
function validarPolitica(entrada) {
  const e = entrada || {};
  const erros = [];
  const premissas = e.premissasPadrao || {};
  const p = {
    configurado: e.configurado === true,
    margemMinimaPercent: numero(e.margemMinimaPercent, 'Margem mínima', erros, { max: 100 }),
    premissasPadrao: {
      impostosPercent: numero(premissas.impostosPercent, 'Impostos', erros, { max: 100 }),
      comissaoPercent: numero(premissas.comissaoPercent, 'Comissão', erros, { max: 100 }),
    },
    validadePropostaDias: numero(e.validadePropostaDias, 'Validade da proposta', erros),
    alcadas: {},
  };
  for (const n of NIVEIS) {
    const a = (e.alcadas || {})[n] || {};
    p.alcadas[n] = {
      descontoMaxPercent: numero(a.descontoMaxPercent, `${ROTULO[n]} — desconto máximo`, erros, { max: 100 }),
      margemMinimaPercent: numero(a.margemMinimaPercent, `${ROTULO[n]} — margem mínima`, erros, { max: 100 }),
      valorMaximoProposta: numero(a.valorMaximoProposta, `${ROTULO[n]} — valor máximo`, erros),
    };
  }
  if (p.validadePropostaDias !== null && !Number.isInteger(p.validadePropostaDias)) erros.push('Validade da proposta: informe dias inteiros.');

  for (let i = 1; i < NIVEIS.length; i++) {
    const baixo = p.alcadas[NIVEIS[i - 1]];
    const alto = p.alcadas[NIVEIS[i]];
    const [nb, na] = [ROTULO[NIVEIS[i - 1]], ROTULO[NIVEIS[i]]];
    if (baixo.descontoMaxPercent !== null && alto.descontoMaxPercent !== null && baixo.descontoMaxPercent > alto.descontoMaxPercent) {
      erros.push(`Desconto máximo do ${nb} (${baixo.descontoMaxPercent}%) não pode ser maior que o do ${na} (${alto.descontoMaxPercent}%).`);
    }
    if (baixo.margemMinimaPercent !== null && alto.margemMinimaPercent !== null && baixo.margemMinimaPercent < alto.margemMinimaPercent) {
      erros.push(`Margem mínima do ${nb} (${baixo.margemMinimaPercent}%) não pode ser menor que a do ${na} (${alto.margemMinimaPercent}%): quem está acima aprova margens menores.`);
    }
    if (baixo.valorMaximoProposta !== null && (alto.valorMaximoProposta !== null && baixo.valorMaximoProposta > alto.valorMaximoProposta)) {
      erros.push(`Valor máximo do ${nb} não pode ser maior que o do ${na}.`);
    }
  }
  for (const n of NIVEIS) {
    const m = p.alcadas[n].margemMinimaPercent;
    if (m !== null && p.margemMinimaPercent !== null && m < p.margemMinimaPercent) {
      erros.push(`Margem mínima do ${ROTULO[n]} (${m}%) está abaixo da mínima geral (${p.margemMinimaPercent}%).`);
    }
  }
  if (p.configurado) {
    if (p.margemMinimaPercent === null) erros.push('Para ativar a política, informe a margem mínima geral.');
    if (p.premissasPadrao.impostosPercent === null) erros.push('Para ativar a política, informe o percentual de impostos (sem ele a margem não é calculável).');
    if (!NIVEIS.some((n) => p.alcadas[n].descontoMaxPercent !== null && p.alcadas[n].margemMinimaPercent !== null)) {
      erros.push('Para ativar a política, configure ao menos uma alçada (desconto máximo e margem mínima).');
    }
  }
  if (erros.length) throw new ErroNegocio('POLITICA_INVALIDA', `Política não salva:\n- ${erros.join('\n- ')}`, erros);
  return p;
}

/** Grava a política na pasta da base (fora do git) e registra antes/depois no histórico. */
function salvarPolitica(base, entrada, { por = 'humano', hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const nova = validarPolitica(entrada);
  const anterior = base.politica();
  const { _arquivo, ...antes } = anterior;
  const registro = {
    descricao: 'Política comercial definida pelo responsável humano.',
    ...nova,
    premissasPadrao: { ...nova.premissasPadrao, observacao: 'Usadas quando a proposta não informa as próprias premissas.' },
    definidaPor: por,
    definidaEm: hoje,
  };
  const arq = path.join(base.dir, 'politica_comercial.json');
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registro, null, 2) + '\n');
  fs.renameSync(tmp, arq);
  base.registrarHistorico('politica', 'politica_comercial', 'atualizar', 'humano', antes, registro);
  return { ...registro, _arquivo: path.relative(path.resolve(__dirname, '..'), arq) };
}

module.exports = { validarPolitica, salvarPolitica, NIVEIS };
