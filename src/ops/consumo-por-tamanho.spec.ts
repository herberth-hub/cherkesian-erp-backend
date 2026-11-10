/**
 * CONSUMO DE TECIDO POR TAMANHO.
 *
 * A receita guarda um consumo padrão por peça e, quando existe o encaixe do
 * Audaces, a metragem medida de CADA tamanho. Um GG gasta meio metro a mais que
 * um P — reservar a média para os dois é como o corte descobre, na mesa, que
 * faltou tecido.
 *
 * O caso que este teste existe para segurar: o encaixe quase nunca cobre a
 * grade inteira (chegam P..G4, faltam PP e G5+). O tamanho sem medida tem de
 * cair no consumo padrão. Antes ele entrava como ZERO e a OP reservava nada.
 */
import { Prisma } from '@prisma/client';
import { OpsService } from './ops.service';

const dec = (n: number) => new Prisma.Decimal(n);

/** Chama o cálculo privado com a receita e o item do pedido. */
const consumo = (
  bom: { quantidade: Prisma.Decimal; porTamanho?: unknown },
  item: { quantidade: number; grade?: unknown },
): number =>
  Number(
    (OpsService.prototype as unknown as {
      consumoDoItem: (b: unknown, i: unknown) => Prisma.Decimal;
    }).consumoDoItem.call({}, bom, item),
  );

// Medidas reais do jaleco unissex (encaixe 145cm, 12 moldes), em metros.
const JALECO = { P: 1.7458, M: 1.9306, G: 1.9892, GG: 2.2223, G1: 2.295, G2: 2.3496, G3: 2.4062, G4: 2.4731 };
const PADRAO = dec(1.8);

describe('com encaixe medido', () => {
  it('cada tamanho gasta a metragem DELE, não a média', () => {
    const r = consumo({ quantidade: PADRAO, porTamanho: JALECO }, { quantidade: 2, grade: { P: 1, GG: 1 } });
    expect(r).toBeCloseTo(1.7458 + 2.2223, 4);
  });

  it('multiplica pela quantidade de cada tamanho', () => {
    const r = consumo({ quantidade: PADRAO, porTamanho: JALECO }, { quantidade: 30, grade: { M: 10, G: 20 } });
    expect(r).toBeCloseTo(1.9306 * 10 + 1.9892 * 20, 4);
  });

  it('tamanho em minúscula na grade continua encontrando a medida', () => {
    const r = consumo({ quantidade: PADRAO, porTamanho: JALECO }, { quantidade: 1, grade: { gg: 1 } });
    expect(r).toBeCloseTo(2.2223, 4);
  });
});

describe('tamanho que ainda não tem encaixe', () => {
  it('cai no consumo padrão da receita — nunca em zero', () => {
    // G5 não está no encaixe; PP também não.
    const r = consumo({ quantidade: PADRAO, porTamanho: JALECO }, { quantidade: 2, grade: { PP: 1, G5: 1 } });
    expect(r).toBeCloseTo(1.8 * 2, 4);
  });

  it('grade misturada soma o medido com o padrão, sem perder ninguém', () => {
    const r = consumo({ quantidade: PADRAO, porTamanho: JALECO }, { quantidade: 3, grade: { G: 2, G8: 1 } });
    expect(r).toBeCloseTo(1.9892 * 2 + 1.8, 4);
  });

  it('nenhum tamanho da grade tem medida: usa a regra antiga (padrão × quantidade)', () => {
    const r = consumo({ quantidade: PADRAO, porTamanho: { XX: 9 } }, { quantidade: 4, grade: { PP: 4 } });
    expect(r).toBeCloseTo(1.8 * 4, 4);
  });
});

describe('sem encaixe nenhum', () => {
  it('receita sem porTamanho multiplica o consumo padrão pela quantidade', () => {
    expect(consumo({ quantidade: PADRAO }, { quantidade: 10, grade: { M: 10 } })).toBeCloseTo(18, 4);
  });

  it('item sem grade (peça única) também usa o padrão', () => {
    expect(consumo({ quantidade: PADRAO, porTamanho: JALECO }, { quantidade: 5 })).toBeCloseTo(9, 4);
  });

  it('porTamanho vazio não zera a reserva', () => {
    expect(consumo({ quantidade: PADRAO, porTamanho: {} }, { quantidade: 7, grade: { G: 7 } })).toBeCloseTo(12.6, 4);
  });
});
