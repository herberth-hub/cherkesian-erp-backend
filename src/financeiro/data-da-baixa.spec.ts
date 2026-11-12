/**
 * A DATA DO PAGAMENTO NO TÍTULO.
 *
 * O título sabia QUANTO foi pago e não sabia QUANDO. Sem o dia, o extrato do
 * banco não casa com o título: o valor existe nos dois lados e nada diz que um
 * lançamento é o outro. É a peça que faltava para a conciliação automática —
 * e por isso as fontes que JÁ sabem a data (retorno CNAB, extrato OFX) têm de
 * usar a data do banco, não a data em que o arquivo foi importado.
 */
import { dataDaBaixa } from './baixa.util';

const HOJE = new Date('2026-11-12T19:30:00Z');
const iso = (d: Date) => d.toISOString();

describe('a data informada por quem lança', () => {
  it('guarda o dia, não o instante — o campo responde "em que dia"', () => {
    expect(iso(dataDaBaixa('2026-11-07', HOJE))).toBe('2026-11-07T00:00:00.000Z');
  });

  it('aceita data retroativa: o boleto foi pago na sexta e lançado na segunda', () => {
    expect(iso(dataDaBaixa('2026-10-30', HOJE))).toBe('2026-10-30T00:00:00.000Z');
  });

  it('sem data informada, assume hoje', () => {
    expect(iso(dataDaBaixa(undefined, HOJE))).toBe('2026-11-12T00:00:00.000Z');
    expect(iso(dataDaBaixa('', HOJE))).toBe('2026-11-12T00:00:00.000Z');
    expect(iso(dataDaBaixa(null, HOJE))).toBe('2026-11-12T00:00:00.000Z');
  });

  it('dia que não existe no calendário não é gravado como outro dia', () => {
    // "31 de fevereiro" vira 03/03 no Date do JS — aqui cai para hoje.
    expect(iso(dataDaBaixa('2026-02-31', HOJE))).toBe('2026-11-12T00:00:00.000Z');
  });

  it('texto que não é data cai para hoje em vez de virar Invalid Date', () => {
    expect(iso(dataDaBaixa('ontem', HOJE))).toBe('2026-11-12T00:00:00.000Z');
  });
});

describe('a data que o banco informa', () => {
  it('Date do retorno CNAB / extrato OFX entra direto, normalizada para o dia', () => {
    const credito = new Date('2026-10-05T13:45:12.000Z');
    expect(iso(dataDaBaixa(credito, HOJE))).toBe('2026-10-05T00:00:00.000Z');
  });

  it('Date inválido não contamina o título — cai para hoje', () => {
    expect(iso(dataDaBaixa(new Date('xx'), HOJE))).toBe('2026-11-12T00:00:00.000Z');
  });

  it('a data do banco vence a de hoje: é o banco que sabe quando o dinheiro andou', () => {
    const credito = new Date('2026-09-01T00:00:00.000Z');
    expect(dataDaBaixa(credito, HOJE).getTime()).toBeLessThan(HOJE.getTime());
  });
});

describe('o dia não escorrega por fuso', () => {
  it('data com hora no fim do dia continua no mesmo dia', () => {
    expect(iso(dataDaBaixa(new Date('2026-11-07T23:59:59Z'), HOJE))).toBe('2026-11-07T00:00:00.000Z');
  });

  it('ISO completo em texto também é reduzido ao dia', () => {
    expect(iso(dataDaBaixa('2026-11-07T18:20:00.000Z', HOJE))).toBe('2026-11-07T00:00:00.000Z');
  });
});
