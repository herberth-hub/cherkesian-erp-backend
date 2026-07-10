import { Prisma, TituloStatus } from '@prisma/client';

/** Dias (inclusive) antes do vencimento em que o título passa a "vencendo". */
const JANELA_VENCENDO_DIAS = 3;

/**
 * Calcula o status de um título (a receber/pagar) a partir de valor, valor pago
 * e vencimento, comparando com "hoje" (data-somente, sem hora).
 */
export function calcularStatusTitulo(
  valor: Prisma.Decimal,
  pago: Prisma.Decimal,
  vencimento: Date,
  hoje: Date = new Date(),
): TituloStatus {
  if (pago.greaterThanOrEqualTo(valor)) return 'pago';

  const d0 = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  const dv = Date.UTC(
    vencimento.getUTCFullYear(),
    vencimento.getUTCMonth(),
    vencimento.getUTCDate(),
  );
  const dias = Math.round((dv - d0) / 86_400_000);

  if (dias < 0) return 'vencida';
  if (dias <= JANELA_VENCENDO_DIAS) return 'vencendo';
  return 'a_vencer';
}
