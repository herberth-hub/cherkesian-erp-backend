/**
 * QUANTIDADE DO ITEM DA NOTA — peça não se vende pela metade.
 *
 * O campo de quantidade da NF-e avulsa é um `<input type="number">`: a RODINHA
 * DO MOUSE e as setinhas mudam o valor sem ninguém digitar nada, e o passo do
 * campo era 0,001. Em 16/11/2026, uma NF-e da Calça Hospitalar Cós Elástico
 * (R$ 40,50) para o MEMORIAL HOSPITAL saiu no formulário com 0,001 e 0,002
 * peça: total R$ 0,12 em vez de R$ 121,50. A multiplicação estava certa — a
 * quantidade é que era absurda, e nada entre o formulário e a SEFAZ reclamou.
 *
 * Esta é a trava do backend. Quando a unidade comercial CONTA PEÇAS (UN, PC,
 * PAR, CX…), a quantidade tem de ser inteira: não existe 0,001 peça numa nota
 * fiscal. Para unidade de MEDIDA (M, KG, L, M²) a fração continua valendo — é
 * assim que se vende tecido e aviamento.
 *
 * O frontend avisa antes (em `nfCalc`), mas o aviso dá para ignorar; esta
 * checagem não.
 */

/**
 * Unidades comerciais que contam coisas inteiras.
 *
 * Deliberadamente curta: o que não estiver aqui é tratado como unidade de
 * medida e aceita fração. Errar para o lado de deixar passar é melhor do que
 * travar uma emissão legítima no meio do expediente.
 */
export const UNIDADES_CONTAVEIS = [
  'UN', 'UND', 'UNID', 'UNIDADE',
  'PC', 'PÇ', 'PCS', 'PECA', 'PEÇA',
  'PAR', 'CX', 'CAIXA', 'KIT', 'JG', 'JOGO', 'PCT', 'PACOTE', 'DZ', 'DUZIA', 'DÚZIA',
];

/** Normaliza a unidade para comparar: sem espaço, sem ponto, em maiúscula. */
function normalizar(unidade: string | null | undefined): string {
  return String(unidade ?? '').trim().replace(/\./g, '').toUpperCase();
}

/**
 * Esta unidade conta peças?
 *
 * Unidade vazia conta como UN: é o padrão do cadastro de produto e o que o
 * formulário avulso manda quando o item não tem produto cadastrado.
 */
export function contaPecas(unidade: string | null | undefined): boolean {
  const u = normalizar(unidade);
  if (!u) return true;
  return UNIDADES_CONTAVEIS.includes(u);
}

/** Inteiro com tolerância de ponto flutuante (0,1+0,2 não é 0,3 em binário). */
export function quantidadeInteira(quantidade: number): boolean {
  if (!Number.isFinite(quantidade)) return false;
  return Math.abs(quantidade - Math.round(quantidade)) < 1e-9;
}

/** Formata a quantidade do jeito que ele vê no formulário (vírgula decimal). */
export function qtdTexto(quantidade: number): string {
  if (!Number.isFinite(quantidade)) return String(quantidade);
  const txt = quantidadeInteira(quantidade)
    ? String(Math.round(quantidade))
    : String(Number(quantidade.toFixed(3)));
  return txt.replace('.', ',');
}

/**
 * Confere a quantidade de UM item.
 *
 * Devolve a mensagem do problema, ou `null` quando está tudo certo. Devolver a
 * mensagem (em vez de lançar) deixa o chamador juntar todos os itens errados
 * numa única resposta — ninguém quer corrigir um item por vez.
 */
export function conferirQuantidadeItem(item: {
  descricao: string;
  quantidade: number;
  unidade?: string | null;
}): string | null {
  const q = Number(item.quantidade);
  const nome = String(item.descricao ?? '').slice(0, 60) || 'item sem descrição';
  if (!Number.isFinite(q) || q <= 0) {
    return `"${nome}": quantidade inválida (${item.quantidade}).`;
  }
  if (contaPecas(item.unidade) && !quantidadeInteira(q)) {
    const un = normalizar(item.unidade) || 'UN';
    return `"${nome}": quantidade ${qtdTexto(q)} ${un} — ${un} conta peças inteiras, não existe fração de peça na nota. Se o produto é vendido por metragem ou peso, corrija a unidade comercial no cadastro.`;
  }
  return null;
}

/**
 * Confere a nota inteira. Devolve a lista de problemas (vazia = pode emitir).
 */
export function conferirQuantidades(
  itens: Array<{ descricao: string; quantidade: number; unidade?: string | null }>,
): string[] {
  return itens.map((it) => conferirQuantidadeItem(it)).filter((m): m is string => m != null);
}
