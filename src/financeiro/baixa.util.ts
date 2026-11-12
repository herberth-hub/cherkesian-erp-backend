/**
 * A DATA DA BAIXA.
 *
 * O dia em que o dinheiro se moveu quase nunca é o dia em que alguém digitou a
 * baixa: o boleto é pago na sexta e lançado na segunda; o extrato do mês é
 * conferido no mês seguinte. Enquanto o título só guardava "quanto", conciliar
 * com o banco era impossível — havia o valor, não havia o dia.
 *
 * Por isso quem lança informa a data, e ela é interpretada como DIA (meia-noite
 * UTC): o campo responde "em que dia", não "em que instante".
 */

/**
 * Meia-noite UTC do dia informado — ou de hoje, quando nada vem.
 *
 * Aceita Date porque as fontes automáticas (retorno CNAB, extrato OFX) já
 * trazem a data pronta do banco: é a melhor data que existe, melhor até que a
 * digitada, e não faz sentido serializá-la só para ser lida de volta.
 */
export function dataDaBaixa(pagoEm?: string | Date | null, hoje: Date = new Date()): Date {
  if (pagoEm instanceof Date && !Number.isNaN(pagoEm.getTime())) {
    return new Date(Date.UTC(pagoEm.getUTCFullYear(), pagoEm.getUTCMonth(), pagoEm.getUTCDate()));
  }
  const texto = String(pagoEm ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (m) {
    const [, a, mes, d] = m;
    const data = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
    // Data impossível ("2026-02-31") rola para o mês seguinte no Date do JS, e
    // o parse solto faz o mesmo. Então não há segunda chance: dia que não
    // existe no calendário cai para hoje, em vez de virar 03/03 sem ninguém ver.
    const valida = data.getUTCMonth() === Number(mes) - 1 && data.getUTCDate() === Number(d);
    return valida ? data : new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  }
  if (texto) {
    const solta = new Date(texto);
    if (!Number.isNaN(solta.getTime())) {
      return new Date(Date.UTC(solta.getUTCFullYear(), solta.getUTCMonth(), solta.getUTCDate()));
    }
  }
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
}
