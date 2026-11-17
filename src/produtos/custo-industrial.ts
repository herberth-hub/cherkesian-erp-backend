/**
 * O CUSTO INDUSTRIAL — o que a fábrica custa para existir, por peça.
 *
 * Material e aplicação são custo DIRETO: dá para apontar a peça que consumiu.
 * Folha, aluguel, energia, contabilidade não — eles existem no mês inteiro e
 * são pagos tendo saído 100 peças ou 10.000. Sem ratear isso, o custo de uma
 * peça é só o pano, a margem parece gorda e a conta não fecha no fim do mês.
 *
 * O rateio é simples de propósito:
 *
 *     custo industrial por peça = (folha + despesas indiretas) / peças produzidas
 *
 * Simples, e por isso mesmo com limites que precisam estar à vista:
 *
 * 1. É um RATEIO IGUAL. Uma calça e uma faixa de cabeça recebem o mesmo valor,
 *    embora a calça ocupe muito mais costureira. Para um mix muito desigual,
 *    este número subestima a peça complexa e encarece a simples.
 * 2. A FACÇÃO fica FORA, por decisão do Herberth em 17/11/2026: ela varia
 *    demais por peça para entrar num rateio igual, e vai lançada peça a peça
 *    na receita (Produto.custoFaccao).
 * 3. MATÉRIA-PRIMA E AVIAMENTO ficam fora porque já estão na BOM. Deixá-los
 *    entrar contaria o tecido duas vezes.
 * 4. IMPOSTO fica fora porque incide sobre a VENDA, não sobre a produção, e é
 *    calculado em cima do preço, com a alíquota do CNPJ que emite.
 * 5. FINANCEIRO (factoring, empréstimo, consórcio, acordo) fica fora: é custo
 *    de capital, não de fabricar. Entrasse aqui, uma antecipação de recebível
 *    faria o preço de tabela subir.
 */

/** Em que balde cada despesa cai. */
export type Balde = 'industrial' | 'direto' | 'faccao' | 'imposto' | 'financeiro';

const N = (s: string | null | undefined): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/**
 * Casamento por PEDAÇO do nome, não por lista fechada.
 *
 * As categorias do contas a pagar são texto livre e o mesmo gasto aparece como
 * "FACÇÃO", "Facção" e "Facção / Mão de obra". Lista fechada deixaria o gasto
 * novo cair calado no balde errado; aqui ele cai em `industrial`, que é o
 * destino conservador, e aparece nomeado no detalhamento para ser corrigido.
 */
const REGRAS: Array<{ balde: Balde; termos: string[] }> = [
  { balde: 'faccao', termos: ['FACCAO', 'MAO DE OBRA', 'COSTUREIRA'] },
  { balde: 'direto', termos: ['MATERIA-PRIMA', 'MATERIA PRIMA', 'MATERIAPRIMA', 'TECIDO', 'AVIAMENTO', 'MALHA', 'REVENDA', 'INSUMO'] },
  { balde: 'imposto', termos: ['IMPOSTO', 'DARE', 'DAS ', 'SIMPLES NACIONAL', 'ICMS', 'PIS', 'COFINS', 'ISS'] },
  { balde: 'financeiro', termos: ['FACTORING', 'EMPRESTIMO', 'PRONAMPE', 'CONSORCIO', 'ACORDO', 'DIVIDA', 'JUROS', 'DESPESAS BANCARIAS', 'TARIFA BANCARIA'] },
];

export function baldeDaCategoria(categoria: string | null | undefined): Balde {
  const c = N(categoria);
  if (!c) return 'industrial';
  for (const r of REGRAS) if (r.termos.some((t) => c.includes(t))) return r.balde;
  return 'industrial';
}

export interface DespesaAgrupada {
  categoria: string;
  total: number;
}

export interface RateioIndustrial {
  /** O que foi rateado. */
  industrial: number;
  /** O que ficou de fora, e onde foi parar — é a prestação de contas do número. */
  fora: Record<Exclude<Balde, 'industrial'>, number>;
  /** Linha a linha, para a tela mostrar de onde veio. */
  porCategoria: Array<{ categoria: string; total: number; balde: Balde }>;
  pecas: number;
  /** R$ por peça. `null` quando não houve produção no período: dividir por zero
   *  daria Infinity, e Infinity numa tela de preço vira um preço absurdo. */
  custoPorPeca: number | null;
  /** Quanto o custo industrial representa do faturamento do período, em %. */
  percentualDoFaturamento: number | null;
  faturamento: number | null;
  /** O que impede o número de ser confiável, em português. */
  avisos: string[];
}

export function ratearCustoIndustrial(args: {
  despesas: DespesaAgrupada[];
  pecas: number;
  faturamento?: number | null;
  /** OPs concluídas sem etiqueta: peça produzida que a contagem não vê. */
  opsSemEtiqueta?: number;
  /**
   * Etiquetas de produto que ficaram FORA da contagem: revenda, que não ocupa
   * costureira, e etiqueta sem produto vinculado, que ninguém sabe o que é.
   *
   * Aparece para ser conferido: se virar um número grande, é cadastro de
   * produto com o tipo errado, e aí o denominador está menor do que deveria.
   */
  foraDaContagem?: number;
}): RateioIndustrial {
  const porCategoria = args.despesas
    .map((d) => ({ categoria: d.categoria, total: Number(d.total) || 0, balde: baldeDaCategoria(d.categoria) }))
    .sort((a, b) => b.total - a.total);

  let industrial = 0;
  const fora = { direto: 0, faccao: 0, imposto: 0, financeiro: 0 };
  for (const l of porCategoria) {
    if (l.balde === 'industrial') industrial += l.total;
    else fora[l.balde] += l.total;
  }

  const pecas = Math.max(0, Math.floor(Number(args.pecas) || 0));
  const faturamento = args.faturamento != null ? Number(args.faturamento) || 0 : null;

  const avisos: string[] = [];
  if (!pecas) avisos.push('Nenhuma peça etiquetada como produção no período — sem base para ratear.');
  if (args.opsSemEtiqueta) {
    avisos.push(
      `${args.opsSemEtiqueta} OP(s) foram baixadas SEM etiqueta e não entram na contagem de peças. O custo por peça sai mais alto do que é.`,
    );
  }
  if (!industrial) avisos.push('Nenhuma despesa indireta lançada no período.');
  if (args.foraDaContagem && pecas && args.foraDaContagem > pecas * 0.1) {
    const juntas = pecas + args.foraDaContagem;
    avisos.push(
      `${args.foraDaContagem.toLocaleString('pt-BR')} peças etiquetadas no período ficaram de fora da contagem por serem revenda ou estarem sem produto vinculado. Se alguma delas for fabricada aqui e estiver com o tipo errado no cadastro, o denominador deveria chegar a ${juntas.toLocaleString('pt-BR')} e o custo cairia para R$ ${(industrial / juntas).toFixed(2).replace('.', ',')} por peça.`,
    );
  }

  return {
    industrial: Number(industrial.toFixed(2)),
    fora: {
      direto: Number(fora.direto.toFixed(2)),
      faccao: Number(fora.faccao.toFixed(2)),
      imposto: Number(fora.imposto.toFixed(2)),
      financeiro: Number(fora.financeiro.toFixed(2)),
    },
    porCategoria,
    pecas,
    custoPorPeca: pecas ? Number((industrial / pecas).toFixed(2)) : null,
    percentualDoFaturamento: faturamento ? Number(((industrial / faturamento) * 100).toFixed(2)) : null,
    faturamento,
    avisos,
  };
}

/**
 * Alíquota de imposto SOBRE A VENDA do CNPJ que emite.
 *
 * Não é o imposto que a peça "tem": é o que sai do preço quando ela é vendida
 * por aquela filial. A mesma peça rende margens diferentes em CNPJs diferentes,
 * e é essa diferença que decide por onde faturar.
 *
 * Simples Nacional: a alíquota efetiva depende do faturamento dos 12 meses e
 * não está no cadastro. Usamos os 5,93% que a tela de precificação já adota —
 * é uma estimativa, e a tela diz que é.
 */
export const ALIQUOTA_SIMPLES_PADRAO = 5.93;

export function aliquotaDeVenda(filial: {
  regimeTributario?: string | null;
  pisAliquota?: unknown;
  cofinsAliquota?: unknown;
} | null | undefined): { aliquota: number; origem: string } {
  const regime = String(filial?.regimeTributario ?? '').toLowerCase();
  if (!filial || regime === 'simples') {
    return { aliquota: ALIQUOTA_SIMPLES_PADRAO, origem: 'Simples Nacional (estimativa — a alíquota efetiva depende do faturamento dos 12 meses)' };
  }
  const pis = Number(filial.pisAliquota ?? 0) || 0;
  const cofins = Number(filial.cofinsAliquota ?? 0) || 0;
  if (!pis && !cofins) {
    return { aliquota: ALIQUOTA_SIMPLES_PADRAO, origem: 'sem alíquota no cadastro da filial — usando a estimativa padrão' };
  }
  const nome = regime === 'lucro_real' ? 'Lucro Real' : 'Lucro Presumido';
  return {
    aliquota: Number((pis + cofins).toFixed(4)),
    origem: `${nome}: PIS ${pis.toFixed(2)}% + COFINS ${cofins.toFixed(2)}% (ICMS não entra — é destacado na nota e varia por UF)`,
  };
}
