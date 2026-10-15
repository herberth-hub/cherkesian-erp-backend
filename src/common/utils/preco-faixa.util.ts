import { Prisma } from '@prisma/client';

/**
 * FAIXAS DE PREÇO POR TAMANHO (preço base x preço especial dos tamanhos grandes).
 *
 * A regra, uma só, vale para o pedido e para os documentos:
 *
 *   Grade MISTA (tem tamanho normal E tamanho da faixa especial na MESMA linha):
 *     o preço digitado vale para os normais e o `precoEspecial` do cadastro entra
 *     nos grandes. É o caso de quem manda a grade inteira de uma vez (portal, API).
 *
 *   Grade de UMA faixa só: o preço digitado É o preço, sem substituição.
 *     A tela de pedido já quebra o item em duas linhas por faixa; a linha dos
 *     tamanhos grandes É a linha especial, e o valor que o usuário pôs nela tem
 *     de valer. Antes o cadastro sobrescrevia, e editar o preço de um item só de
 *     G1..G8 simplesmente não salvava (PV187: G3 voltava sempre a R$ 35,00).
 */

type ProdutoFaixa = { tamsEspeciais?: string | null; precoEspecial?: Prisma.Decimal | number | null } | null;

/** Tamanhos da faixa especial do produto ("G1,G2,G3" -> ["G1","G2","G3"]). */
export function tamanhosEspeciais(produto: ProdutoFaixa): string[] {
  return produto?.tamsEspeciais
    ? String(produto.tamsEspeciais).split(/[,;/.\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [];
}

/** A grade mistura tamanho normal com tamanho da faixa especial? */
export function gradeMista(produto: ProdutoFaixa, grade: Record<string, number> | null | undefined): boolean {
  if (!grade || produto?.precoEspecial == null) return false;
  const esp = tamanhosEspeciais(produto);
  if (!esp.length) return false;
  let temEsp = false;
  let temNormal = false;
  for (const [tam, q] of Object.entries(grade)) {
    if (!(Number(q) > 0)) continue;
    if (esp.includes(String(tam).toUpperCase())) temEsp = true;
    else temNormal = true;
  }
  return temEsp && temNormal;
}

/**
 * Preço de um tamanho dentro de uma linha. `misto` vem de gradeMista(): só aí o
 * cadastro substitui o preço digitado nos tamanhos grandes.
 */
export function precoDoTamanho(
  produto: ProdutoFaixa,
  base: Prisma.Decimal,
  tam: string,
  misto: boolean,
): Prisma.Decimal {
  if (!misto) return base;
  if (produto?.precoEspecial != null && tamanhosEspeciais(produto).includes(String(tam).toUpperCase())) {
    return new Prisma.Decimal(produto.precoEspecial);
  }
  return base;
}

/** Subtotal de uma linha com grade, aplicando a regra acima. */
export function subtotalDaGrade(
  produto: ProdutoFaixa,
  base: Prisma.Decimal,
  grade: Record<string, number> | null | undefined,
  quantidade: number,
): Prisma.Decimal {
  if (!grade || typeof grade !== 'object') return base.mul(quantidade);
  const misto = gradeMista(produto, grade);
  let s = new Prisma.Decimal(0);
  for (const [tam, q] of Object.entries(grade)) {
    s = s.plus(precoDoTamanho(produto, base, tam, misto).mul(Number(q) || 0));
  }
  return s;
}
