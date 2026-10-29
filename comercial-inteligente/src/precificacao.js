'use strict';

/**
 * Margem de contribuição, markup, desconto e alçada de aprovação.
 *
 * Margem de contribuição % = (receita líquida − custos e despesas variáveis) ÷ receita líquida × 100
 *   receita bruta      = preço unitário × quantidade
 *   receita líquida    = receita bruta − impostos sobre a venda
 *   custos variáveis   = custo variável unitário × quantidade + comissão + frete assumido + outros variáveis
 *   comissão           = % sobre a receita bruta (premissa documentada)
 *
 * Markup é outra coisa: multiplicador preço ÷ custo variável unitário. Nunca usar um no lugar do outro.
 */

const H = require('./hierarquia');

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const vazio = (v) => v === undefined || v === null || (typeof v === 'number' && isNaN(v));

/** Custo variável unitário a partir de componentes (tecido, aviamentos, costura...) ou valor direto. */
function custoUnitario(item = {}, produto = {}) {
  const componentes = item.componentesCusto || (vazio(item.custoVariavelUnitario) ? produto.componentesCusto : null);
  if (componentes && Object.keys(componentes).length) {
    const faltantes = Object.entries(componentes).filter(([, v]) => vazio(v)).map(([k]) => k);
    const soma = Object.values(componentes).filter((v) => !vazio(v)).reduce((a, b) => a + Number(b), 0);
    return { valor: r2(soma), provisorio: faltantes.length > 0, faltantes, fonte: 'componentes de custo' };
  }
  if (!vazio(item.custoVariavelUnitario)) return { valor: item.custoVariavelUnitario, provisorio: false, faltantes: [], fonte: 'informado na proposta' };
  if (!vazio(produto.custoVariavelUnitario)) {
    return { valor: produto.custoVariavelUnitario, provisorio: false, faltantes: [], fonte: produto.custoFonte || 'cadastro do produto' };
  }
  return { valor: null, provisorio: true, faltantes: ['custoVariavelUnitario'], fonte: null };
}

/**
 * Calcula a margem de contribuição de uma venda.
 * Campos críticos ausentes (preço, quantidade, custo, impostos) => "nao_calculavel".
 * Campos acessórios ausentes (comissão, frete, outros) ou custo incompleto => "provisoria",
 * assumindo zero e declarando a premissa.
 */
function calcularMargem(e) {
  const criticos = ['precoUnitario', 'quantidade', 'custoVariavelUnitario', 'impostosPercent'].filter((k) => vazio(e[k]));
  if (criticos.length) {
    return {
      status: 'nao_calculavel',
      percentual: null,
      faltantes: [...criticos, ...(e.custoFaltantes || [])],
      premissas: [],
      mensagem: `Margem NÃO CALCULÁVEL: faltam ${criticos.join(', ')}.`,
    };
  }
  const premissas = [];
  const acessorio = (campo, rotulo) => {
    if (vazio(e[campo])) {
      premissas.push(`${rotulo} não informado(a): assumido 0 (margem provisória).`);
      return 0;
    }
    return Number(e[campo]);
  };
  const comissaoPct = acessorio('comissaoPercent', 'Comissão');
  const frete = acessorio('freteTotal', 'Frete assumido pela empresa');
  const outros = acessorio('outrosCustosVariaveis', 'Outros custos variáveis');
  if (e.custoProvisorio) premissas.push(`Custo unitário incompleto (faltam: ${(e.custoFaltantes || []).join(', ')}).`);

  const receitaBruta = e.precoUnitario * e.quantidade;
  const impostos = (receitaBruta * e.impostosPercent) / 100;
  const receitaLiquida = receitaBruta - impostos;
  const custoProdutos = e.custoVariavelUnitario * e.quantidade;
  const comissao = (receitaBruta * comissaoPct) / 100;
  const custosVariaveis = custoProdutos + comissao + frete + outros;
  const margemContribuicao = receitaLiquida - custosVariaveis;
  const percentual = receitaLiquida > 0 ? r2((margemContribuicao / receitaLiquida) * 100) : null;
  const status = premissas.length ? 'provisoria' : 'calculada';

  return {
    status,
    percentual,
    faltantes: e.custoFaltantes || [],
    premissas,
    receitaBruta: r2(receitaBruta),
    impostos: r2(impostos),
    receitaLiquida: r2(receitaLiquida),
    custoProdutos: r2(custoProdutos),
    comissao: r2(comissao),
    frete: r2(frete),
    outrosCustosVariaveis: r2(outros),
    custosVariaveis: r2(custosVariaveis),
    margemContribuicao: r2(margemContribuicao),
    markupMultiplicador: e.custoVariavelUnitario > 0 ? r2(e.precoUnitario / e.custoVariavelUnitario) : null,
    memoria: [
      `Receita bruta = ${e.precoUnitario} × ${e.quantidade} = ${r2(receitaBruta)}`,
      `Impostos = ${r2(receitaBruta)} × ${e.impostosPercent}% = ${r2(impostos)}`,
      `Receita líquida = ${r2(receitaBruta)} − ${r2(impostos)} = ${r2(receitaLiquida)}`,
      `Custos variáveis = ${r2(custoProdutos)} (produtos) + ${r2(comissao)} (comissão ${comissaoPct}% s/ bruta) + ${r2(frete)} (frete) + ${r2(outros)} (outros) = ${r2(custosVariaveis)}`,
      `Margem de contribuição = ${r2(receitaLiquida)} − ${r2(custosVariaveis)} = ${r2(margemContribuicao)}`,
      `MC% = ${r2(margemContribuicao)} ÷ ${r2(receitaLiquida)} × 100 = ${percentual}%`,
    ],
  };
}

/** Desconto ponderado em relação ao preço autorizado. Itens sem preço autorizado são listados à parte. */
function calcularDesconto(itens, produtosPorId) {
  let tabela = 0;
  let praticado = 0;
  const semPrecoAutorizado = [];
  for (const it of itens) {
    const p = it.produtoId ? produtosPorId[it.produtoId] : null;
    if (!p || vazio(p.precoAutorizado)) {
      semPrecoAutorizado.push(it.descricao);
      continue;
    }
    tabela += p.precoAutorizado * it.quantidade;
    praticado += it.precoUnitario * it.quantidade;
  }
  const percentual = tabela > 0 ? r2(Math.max(0, ((tabela - praticado) / tabela) * 100)) : 0;
  return { percentual, semPrecoAutorizado };
}

const NIVEIS_ALCADA = ['vendedor', 'gerente', 'diretor', 'ceo'];

/**
 * Menor papel com alçada para aprovar a condição. Regras:
 *  - política não configurada                       → humano
 *  - margem abaixo da mínima definida pelo humano    → humano (nunca aprovação automática)
 *  - margem não calculável / item sem preço tabela   → no mínimo diretor
 *  - margem provisória                               → no mínimo gerente
 *  - cliente/oportunidade estratégica                → no mínimo diretor
 *  - nenhum nível comporta desconto/margem/valor     → humano
 */
function determinarAlcada({ margem, descontoPercent = 0, valorTotal = 0, politica, estrategica = false, semPrecoAutorizado = [] }) {
  const motivos = [];
  if (!politica || politica.configurado !== true) {
    return { alcada: 'humano', motivos: ['Política comercial não configurada pelo responsável humano.'], autoAprovavel: false };
  }
  if (margem && margem.percentual != null && !vazio(politica.margemMinimaPercent) && margem.percentual < politica.margemMinimaPercent) {
    return {
      alcada: 'humano',
      motivos: [`Margem ${margem.percentual}% abaixo da mínima de ${politica.margemMinimaPercent}% definida pelo responsável humano.`],
      autoAprovavel: false,
    };
  }
  let minimo = 'vendedor';
  if (!margem || margem.status === 'nao_calculavel') {
    minimo = H.maiorPapel(minimo, 'diretor');
    motivos.push('Margem não calculável: estrutura de custos incompleta.');
  } else if (margem.status === 'provisoria') {
    minimo = H.maiorPapel(minimo, 'gerente');
    motivos.push('Margem provisória: premissas assumidas.');
  }
  if (semPrecoAutorizado.length) {
    minimo = H.maiorPapel(minimo, 'diretor');
    motivos.push(`Item(ns) sem preço autorizado: ${semPrecoAutorizado.join('; ')}.`);
  }
  if (estrategica) {
    minimo = H.maiorPapel(minimo, 'diretor');
    motivos.push('Oportunidade/cliente estratégico.');
  }

  const cabe = (nivel) => {
    const a = (politica.alcadas || {})[nivel];
    if (!a) return false;
    if (vazio(a.descontoMaxPercent) || descontoPercent > a.descontoMaxPercent) return false;
    if (margem && margem.percentual != null && (vazio(a.margemMinimaPercent) || margem.percentual < a.margemMinimaPercent)) return false;
    if (!vazio(a.valorMaximoProposta) && valorTotal > a.valorMaximoProposta) return false;
    return true;
  };
  const candidato = NIVEIS_ALCADA.find(cabe);
  if (!candidato) {
    motivos.push(`Nenhuma alçada configurada comporta desconto de ${descontoPercent}%${margem && margem.percentual != null ? `, margem de ${margem.percentual}%` : ''} e valor ${r2(valorTotal)}.`);
    return { alcada: 'humano', motivos, autoAprovavel: false };
  }
  const alcada = H.maiorPapel(candidato, minimo);
  if (alcada !== candidato) motivos.push(`Condições caberiam na alçada "${candidato}", mas o mínimo exigido é "${minimo}".`);
  else motivos.push(`Dentro da alçada "${alcada}" (desconto ${descontoPercent}%${margem && margem.percentual != null ? `, margem ${margem.percentual}%` : ''}).`);
  return { alcada, motivos, autoAprovavel: alcada === 'vendedor' && margem && margem.status === 'calculada' };
}

/** Avaliação completa de uma proposta: totais, margem, desconto, alçada e pendências. */
function avaliarProposta(proposta, { produtosPorId = {}, politica, estrategica = false, hoje } = {}) {
  const premissas = proposta.premissasCusto || {};
  const padrao = (politica && politica.premissasPadrao) || {};
  const impostosPercent = !vazio(premissas.impostosPercent) ? premissas.impostosPercent : padrao.impostosPercent;
  const comissaoPercent = !vazio(premissas.comissaoPercent) ? premissas.comissaoPercent : padrao.comissaoPercent;

  let quantidade = 0;
  let receitaBruta = 0;
  let custoTotal = 0;
  let custoCompleto = true;
  let custoProvisorio = false;
  const custoFaltantes = [];
  const itens = proposta.itens.map((it) => {
    const produto = it.produtoId ? produtosPorId[it.produtoId] || {} : {};
    const custo = custoUnitario(it, produto);
    quantidade += it.quantidade;
    receitaBruta += it.precoUnitario * it.quantidade;
    if (custo.valor == null) custoCompleto = false;
    else custoTotal += custo.valor * it.quantidade;
    if (custo.provisorio) custoProvisorio = true;
    custoFaltantes.push(...custo.faltantes.map((f) => `${it.descricao}: ${f}`));
    return {
      descricao: it.descricao,
      quantidade: it.quantidade,
      precoUnitario: it.precoUnitario,
      total: r2(it.precoUnitario * it.quantidade),
      precoAutorizado: vazio(produto.precoAutorizado) ? null : produto.precoAutorizado,
      custoUnitario: custo.valor,
      custoFonte: custo.fonte,
    };
  });

  // Margem agregada: custo médio ponderado e preço médio ponderado reproduzem exatamente os totais.
  const margem = calcularMargem({
    precoUnitario: quantidade ? receitaBruta / quantidade : null,
    quantidade,
    custoVariavelUnitario: custoCompleto && quantidade ? custoTotal / quantidade : null,
    custoProvisorio,
    custoFaltantes,
    impostosPercent,
    comissaoPercent,
    freteTotal: premissas.freteTotal,
    outrosCustosVariaveis: premissas.outrosCustosVariaveis,
  });
  const desconto = calcularDesconto(proposta.itens, produtosPorId);
  const alcada = determinarAlcada({
    margem,
    descontoPercent: desconto.percentual,
    valorTotal: receitaBruta,
    politica,
    estrategica,
    semPrecoAutorizado: desconto.semPrecoAutorizado,
  });

  const pendencias = [];
  if (!proposta.prazoEntrega || !proposta.prazoEntrega.confirmadoOperacao) {
    pendencias.push('Prazo de entrega NÃO confirmado pela operação (PCP/produção): informar "sujeito à confirmação".');
  }
  if (!proposta.validadeAte) pendencias.push('Validade da proposta não informada.');
  else if (hoje && proposta.validadeAte < hoje) pendencias.push(`Proposta vencida em ${proposta.validadeAte}.`);
  if (!proposta.condicoesPagamento) pendencias.push('Condições de pagamento não informadas.');
  if (desconto.percentual > 0 && !proposta.justificativaDesconto) pendencias.push('Desconto sem justificativa registrada.');

  return {
    propostaId: proposta.id,
    itens,
    quantidadeTotal: quantidade,
    valorTotal: r2(receitaBruta),
    premissasUsadas: {
      impostosPercent: vazio(impostosPercent) ? null : impostosPercent,
      comissaoPercent: vazio(comissaoPercent) ? null : comissaoPercent,
      freteTotal: vazio(premissas.freteTotal) ? null : premissas.freteTotal,
      outrosCustosVariaveis: vazio(premissas.outrosCustosVariaveis) ? null : premissas.outrosCustosVariaveis,
      fonteImpostos: !vazio(premissas.impostosPercent) ? 'proposta' : vazio(padrao.impostosPercent) ? 'ausente' : 'política (padrão)',
    },
    margem,
    descontoPercent: desconto.percentual,
    semPrecoAutorizado: desconto.semPrecoAutorizado,
    alcadaNecessaria: alcada.alcada,
    motivosAlcada: alcada.motivos,
    autoAprovavel: alcada.autoAprovavel,
    pendencias,
  };
}

module.exports = { r2, custoUnitario, calcularMargem, calcularDesconto, determinarAlcada, avaliarProposta, NIVEIS_ALCADA };
