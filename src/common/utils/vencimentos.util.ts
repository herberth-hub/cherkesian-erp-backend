/**
 * VENCIMENTOS E PARCELAS de um título a receber.
 *
 * A regra é a mesma em todo lugar que lança cobrança (expedição despachada sem
 * NF, venda de comodato): o vencimento vem da data informada, ou dos prazos
 * escritos na forma de pagamento ("30/60/90" → três parcelas), ou é hoje. Ficava
 * copiada dentro de cada serviço; duas cópias da regra de cobrança é como se
 * cobra diferente no mesmo sistema sem ninguém perceber.
 */

/** Prazos em dias escritos na forma de pagamento ("28 dias", "30/60/90"). */
export function prazosDaForma(forma: string | null | undefined): number[] {
  return [...String(forma ?? '').replace(/\([^)]*\)/g, ' ').matchAll(/\d+/g)]
    .map((m) => parseInt(m[0], 10))
    .filter((n) => n > 0 && n <= 360)
    .sort((a, b) => a - b);
}

export type PlanoCobranca = { vencimentos: Date[]; valores: number[] };

/**
 * Monta o plano de cobrança: quando vence cada parcela e quanto é cada uma.
 * A última parcela absorve o centavo da divisão — a soma fecha com o total.
 *
 * @param total   valor a cobrar (R$)
 * @param forma   forma de pagamento, de onde saem os prazos
 * @param dto     data de vencimento explícita (YYYY-MM-DD) e/ou nº de parcelas
 * @param hoje    base do cálculo (injetável para o teste)
 */
export function planoCobranca(
  total: number,
  forma: string | null | undefined,
  dto: { vencimento?: string; parcelas?: number } = {},
  hoje: Date = new Date(),
): PlanoCobranca {
  const base0 = new Date(hoje);
  base0.setHours(0, 0, 0, 0);

  let vencimentos: Date[];
  if (dto.vencimento) {
    const v = new Date(dto.vencimento + (dto.vencimento.length <= 10 ? 'T12:00:00' : ''));
    if (isNaN(v.getTime())) throw new Error(`Vencimento inválido: "${dto.vencimento}".`);
    vencimentos = [v];
  } else {
    const dias = prazosDaForma(forma);
    vencimentos = dias.length
      ? dias.map((n) => { const x = new Date(base0); x.setDate(x.getDate() + n); return x; })
      : [base0];
  }

  // Parcelas explícitas (sem prazo na forma): divide a partir do 1º vencimento, de 30 em 30.
  const nParc = Math.max(1, Math.min(Number(dto.parcelas ?? vencimentos.length) || 1, 12));
  if (nParc > vencimentos.length) {
    const ini = vencimentos[0];
    vencimentos = Array.from({ length: nParc }, (_, i) => { const x = new Date(ini); x.setDate(x.getDate() + i * 30); return x; });
  }

  const parcela = Number((total / vencimentos.length).toFixed(2));
  const valores = vencimentos.map((_, i) =>
    i === vencimentos.length - 1 ? Number((total - parcela * (vencimentos.length - 1)).toFixed(2)) : parcela);
  return { vencimentos, valores };
}
