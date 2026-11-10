/**
 * QUANDO O PEDIDO EXIGE PEÇA-PILOTO.
 *
 * A piloto existe para aprovar uma peça que a casa nunca fez: modelagem,
 * caimento, bordado, tamanho da logo. Isso é propriedade do PRODUTO, não do
 * cliente — um cliente novo comprando um jaleco que a fábrica produz há dois
 * anos não precisa de amostra nenhuma, e segurar o pedido dele na etapa
 * "piloto" só atrasa a entrega.
 *
 * A regra antiga era `cliente.clienteNovo`, e foi por ela que o PV227 (INTS
 * HDSA, três produtos já produzidos no PV28) parou em piloto.
 *
 * Um produto conta como JÁ PRODUZIDO quando tem pelo menos uma OP não
 * cancelada ou uma peça-piloto liberada — nos dois casos a modelagem já passou
 * pelo crivo.
 */

export interface ItemDoPedido {
  produtoId: number | null;
  descricao: string;
  quantidade: number;
}

export interface ProdutoSemHistorico {
  produtoId: number;
  descricao: string;
}

/**
 * Produtos do pedido que nunca foram produzidos — os únicos que exigem piloto.
 *
 * Item em TEXTO LIVRE (sem produto do catálogo) fica de fora de propósito: ele
 * já tem bloqueio próprio, e mais específico, na geração da OP ("vincule a um
 * produto cadastrado"). Mandar o pedido para piloto por causa dele daria duas
 * travas para o mesmo problema, nenhuma delas explicando o que fazer.
 */
export function produtosQueExigemPiloto(
  itens: ItemDoPedido[],
  jaProduzidos: ReadonlySet<number>,
): ProdutoSemHistorico[] {
  const vistos = new Set<number>();
  const novos: ProdutoSemHistorico[] = [];
  for (const item of itens) {
    const id = item.produtoId;
    if (id == null || !(item.quantidade > 0)) continue;
    if (jaProduzidos.has(id) || vistos.has(id)) continue;
    vistos.add(id);
    novos.push({ produtoId: id, descricao: item.descricao });
  }
  return novos;
}

/** Etapa em que o pedido entra ao ser aprovado. */
export function etapaAoAprovar(novos: ProdutoSemHistorico[]): 'piloto' | 'aprovado' {
  return novos.length ? 'piloto' : 'aprovado';
}

/** Frase que nomeia os produtos — quem lê precisa saber de QUAL peça se trata. */
export function motivoPiloto(novos: ProdutoSemHistorico[]): string {
  if (!novos.length) return '';
  const lista = novos.map((p) => `"${p.descricao}"`).join(', ');
  return novos.length === 1
    ? `O produto ${lista} nunca foi produzido: é necessária uma peça-piloto aprovada antes de gerar a OP.`
    : `${novos.length} produtos deste pedido nunca foram produzidos (${lista}): é necessária uma peça-piloto aprovada antes de gerar a OP.`;
}
