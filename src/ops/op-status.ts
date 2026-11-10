/**
 * O QUE CONTA COMO OP VIVA.
 *
 * Até aqui "ativa" era simplesmente `status != concluido`, e isso bastava
 * enquanto concluído era a única forma de uma OP terminar. Com o cancelamento,
 * passou a haver uma segunda: OP de pedido cancelado está encerrada do mesmo
 * jeito — não se produz, não atrasa, não entra em fila nem em indicador.
 *
 * O risco de deixar a regra espalhada em `!== 'concluido'` por oito arquivos é
 * ela ficar certa em uns e errada em outros: a OP cancelada sumiria da fila do
 * PCP mas continuaria pintada de vermelho no radar de atraso do painel. Por
 * isso a regra mora aqui, e todo mundo pergunta para o mesmo lugar.
 */

/** Estados em que a OP já terminou — por bem ou por mal. */
export const OP_ENCERRADAS = ['concluido', 'cancelado'] as const;
export type OpEncerrada = (typeof OP_ENCERRADAS)[number];

/** Estados que o cancelamento do pedido NÃO mexe: já produzido fica produzido. */
export const OP_NAO_CANCELAVEL = ['concluido', 'cancelado'] as const;

/** true quando a OP ainda está em jogo (produz, atrasa, entra na fila). */
export function opViva(status: string | null | undefined): boolean {
  return !(OP_ENCERRADAS as readonly string[]).includes(String(status ?? ''));
}

/** true quando o cancelamento do pedido deve derrubar esta OP. */
export function opCancelavel(status: string | null | undefined): boolean {
  return !(OP_NAO_CANCELAVEL as readonly string[]).includes(String(status ?? ''));
}

/**
 * Filtro Prisma de OP viva — use no lugar de `{ status: { not: 'concluido' } }`.
 * É função, e não constante, porque o Prisma exige um array mutável: devolver
 * sempre um objeto novo evita que alguém mexa no filtro de todo mundo sem querer.
 */
export function whereOpViva(): { status: { notIn: OpEncerrada[] } } {
  return { status: { notIn: [...OP_ENCERRADAS] } };
}

/**
 * Aviso para colar na OP cancelada, para quem abrir depois saber por quê.
 * Mantém o motivo junto do registro em vez de só no log.
 */
export function avisoCancelamento(pedidoNumero: string, antes: string): string {
  return `❌ CANCELADA — o pedido ${pedidoNumero} foi cancelado (a OP estava em "${String(antes).replace(/_/g, ' ')}"). Não produzir.`;
}
