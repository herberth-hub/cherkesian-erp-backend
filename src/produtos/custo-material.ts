/**
 * O CUSTO DO MATERIAL NA RECEITA.
 *
 * A malha é COMPRADA por quilo e CONSUMIDA por metro. A receita guarda metros;
 * o cadastro guarda R$/kg. Multiplicar um pelo outro dá um número que parece
 * dinheiro e não é: na CAMISETA GOLA V (PRD-CAM-0085) saíam R$ 28,19 de tecido
 * onde o custo real é R$ 10,45 — quase 3x, que é exatamente o rendimento do
 * artigo (2,7 metros por quilo). Com esse número a peça fica cara no papel, e
 * uma precificação feita em cima dele perde venda por um custo que não existe.
 *
 * A ponte entre as duas unidades é física e está na ficha do tecido:
 *
 *     kg por metro linear = largura (m) × gramatura (g/m²) ÷ 1000
 *
 * Sem largura ou sem gramatura não há conversão possível. Aí o certo é DIZER
 * que não dá — devolver o subtotal como desconhecido — e não multiplicar por 1
 * fingindo que metro e quilo são a mesma coisa. Um custo errado em silêncio é
 * pior do que um custo ausente: ninguém confere o que não pediu atenção.
 *
 * NÃO use `gramaturaLinear` para isto. O campo está documentado como g/ml, mas
 * nos cadastros reais aparece preenchido como RENDIMENTO (m/kg): no MP-TEC-0041
 * vale 2,7, que é 1 ÷ 0,3706 — o inverso do que o nome promete. Enquanto as duas
 * convenções convivem no banco, largura × gramatura é o único caminho que não
 * depende de adivinhar qual delas o cadastro seguiu.
 */

/** Material, na parte que interessa para o custo. */
export interface MaterialDeCusto {
  unidade?: string | null;
  custo?: unknown; // Decimal do Prisma, string ou number
  largura?: unknown;
  gramatura?: unknown;
}

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = Number(v as never);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Unidade em forma canônica. Cada um digita de um jeito ("m", "MT", "Metros",
 * "kg", "KG") e a comparação crua trata o mesmo artigo como duas unidades.
 */
export function normalizarUnidade(u: string | null | undefined): string {
  const s = String(u ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\s]/g, '');
  if (!s) return '';
  if (['M', 'MT', 'MTS', 'METRO', 'METROS', 'ML'].includes(s)) return 'M';
  if (['KG', 'KGS', 'K', 'QUILO', 'QUILOS', 'QUILOGRAMA', 'QUILOGRAMAS'].includes(s)) return 'KG';
  if (['G', 'GR', 'GRAMA', 'GRAMAS'].includes(s)) return 'G';
  if (['UN', 'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'PC', 'PÇ', 'PCS', 'PECA', 'PEÇA'].includes(s)) return 'UN';
  return s;
}

/** Quilos de um metro linear do artigo, ou null quando a ficha não permite saber. */
export function kgPorMetro(material: MaterialDeCusto): number | null {
  const largura = num(material.largura);
  const gramatura = num(material.gramatura);
  if (!(largura > 0) || !(gramatura > 0)) return null;
  return (largura * gramatura) / 1000;
}

export interface LinhaDeCusto {
  /** Quantidade já na unidade em que o material é precificado. */
  quantidade: number | null;
  /** Unidade do cadastro do material (a do preço). */
  unidade: string;
  /** Quanto se multiplicou para sair da unidade da receita (1 = nada a fazer). */
  fator: number | null;
  custoUnit: number;
  /** null = não dá para saber, não é zero. */
  subtotal: number | null;
  /** Frase pronta para a tela quando a conversão não foi possível. */
  aviso: string | null;
}

/**
 * Converte a quantidade da receita para a unidade de preço do material e
 * devolve o subtotal — ou o motivo de não dar.
 */
export function custoDaLinha(args: {
  quantidade: unknown;
  unidadeReceita: string | null | undefined;
  material: MaterialDeCusto | null | undefined;
}): LinhaDeCusto {
  const m = args.material ?? {};
  const custoUnit = num(m.custo);
  const qtd = num(args.quantidade);
  const unRec = normalizarUnidade(args.unidadeReceita);
  const unMat = normalizarUnidade(m.unidade);
  const base: LinhaDeCusto = {
    quantidade: qtd,
    unidade: unMat || unRec,
    fator: 1,
    custoUnit,
    subtotal: Number((qtd * custoUnit).toFixed(4)),
    aviso: null,
  };

  // Mesma unidade (ou o material sem unidade cadastrada): multiplicação direta.
  if (!unMat || !unRec || unMat === unRec) return base;

  const kgM = kgPorMetro(m);

  if (unRec === 'M' && unMat === 'KG') {
    if (kgM == null) {
      return {
        ...base,
        quantidade: null,
        fator: null,
        subtotal: null,
        aviso: 'A receita está em metros e o material é cobrado por quilo. Preencha largura e gramatura na ficha do material para converter.',
      };
    }
    const q = qtd * kgM;
    return { ...base, quantidade: q, fator: kgM, subtotal: Number((q * custoUnit).toFixed(4)) };
  }

  if (unRec === 'KG' && unMat === 'M') {
    if (kgM == null || !(kgM > 0)) {
      return {
        ...base,
        quantidade: null,
        fator: null,
        subtotal: null,
        aviso: 'A receita está em quilos e o material é cobrado por metro. Preencha largura e gramatura na ficha do material para converter.',
      };
    }
    const q = qtd / kgM;
    return { ...base, quantidade: q, fator: 1 / kgM, subtotal: Number((q * custoUnit).toFixed(4)) };
  }

  if (unRec === 'G' && unMat === 'KG') {
    const q = qtd / 1000;
    return { ...base, quantidade: q, fator: 0.001, subtotal: Number((q * custoUnit).toFixed(4)) };
  }
  if (unRec === 'KG' && unMat === 'G') {
    const q = qtd * 1000;
    return { ...base, quantidade: q, fator: 1000, subtotal: Number((q * custoUnit).toFixed(4)) };
  }

  // Unidades que não se convertem (peça × metro, por exemplo). Não inventa fator.
  return {
    ...base,
    quantidade: null,
    fator: null,
    subtotal: null,
    aviso: `A receita está em "${args.unidadeReceita}" e o material é cobrado em "${m.unidade}". Acerte a unidade de um dos dois.`,
  };
}

/**
 * Consumo que não é consumo de peça.
 *
 * Dois produtos chegaram ao banco com 99 no tamanho PP (99 cm digitados onde se
 * esperava 0,99 m) e ninguém viu, porque 99 some no meio da tabela e só reaparece
 * como um custo de material de R$ 2.517,10. Um número tão fora da ordem de
 * grandeza de uma peça de roupa merece ser apontado na hora de digitar.
 */
export function consumoSuspeito(quantidade: unknown, unidade: string | null | undefined): string | null {
  const q = num(quantidade);
  const un = normalizarUnidade(unidade);
  if (un !== 'M' && un !== 'KG') return null; // peça, par, caixa: 50 botões é normal
  if (q >= 20) {
    return `${q.toLocaleString('pt-BR')} ${un === 'M' ? 'metros' : 'quilos'} por peça. Veja se não é centímetro ou grama digitado no campo de metro/quilo.`;
  }
  return null;
}
