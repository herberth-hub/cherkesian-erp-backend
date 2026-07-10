import { Prisma } from '@prisma/client';
import { calcularStatusTitulo } from './titulo-status.util';

const D = (n: number) => new Prisma.Decimal(n);
const dias = (base: Date, n: number) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

describe('calcularStatusTitulo', () => {
  const hoje = new Date('2026-07-10T12:00:00Z');

  it('pago quando o valor pago cobre o total', () => {
    expect(calcularStatusTitulo(D(100), D(100), dias(hoje, 30), hoje)).toBe('pago');
    expect(calcularStatusTitulo(D(100), D(150), dias(hoje, -5), hoje)).toBe('pago'); // pago vence prioridade
  });

  it('vencida quando passou do vencimento e não quitado', () => {
    expect(calcularStatusTitulo(D(100), D(0), dias(hoje, -1), hoje)).toBe('vencida');
    expect(calcularStatusTitulo(D(100), D(50), dias(hoje, -10), hoje)).toBe('vencida');
  });

  it('vencendo dentro da janela de 3 dias', () => {
    expect(calcularStatusTitulo(D(100), D(0), dias(hoje, 0), hoje)).toBe('vencendo'); // hoje
    expect(calcularStatusTitulo(D(100), D(0), dias(hoje, 3), hoje)).toBe('vencendo');
  });

  it('a_vencer quando falta mais que a janela', () => {
    expect(calcularStatusTitulo(D(100), D(0), dias(hoje, 4), hoje)).toBe('a_vencer');
    expect(calcularStatusTitulo(D(100), D(99), dias(hoje, 30), hoje)).toBe('a_vencer');
  });
});
