/**
 * Faixa de preço por tamanho: o preço digitado tem de valer.
 *
 * O PV187 (Instituto Social Prosperar) mostrou o furo: o item com grade só de
 * G3 (faixa especial) voltava SEMPRE a R$ 35,00 — o precoEspecial do cadastro —
 * e editar o preço na tela não salvava nada. A faixa do cadastro só pode entrar
 * quando a grade MISTURA tamanho normal com tamanho especial na mesma linha.
 */
import { Prisma } from '@prisma/client';
import { gradeMista, precoDoTamanho, subtotalDaGrade, tamanhosEspeciais } from './preco-faixa.util';

const D = (n: number) => new Prisma.Decimal(n);
// PRD-CAM-0078 — CAMISETA BÁSICA GOLA CARECA MC - PROSPERAR
const PROD = { tamsEspeciais: 'G1,G2,G3,G4,G5,G6,G7,G8', precoEspecial: D(35) };
const SEM_ESP = { tamsEspeciais: null, precoEspecial: null };

describe('tamanhosEspeciais', () => {
  it('quebra a lista do cadastro e normaliza', () => {
    expect(tamanhosEspeciais(PROD)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']);
    expect(tamanhosEspeciais({ tamsEspeciais: ' g1; g2 / g3 ', precoEspecial: D(10) })).toEqual(['G1', 'G2', 'G3']);
    expect(tamanhosEspeciais(SEM_ESP)).toEqual([]);
    expect(tamanhosEspeciais(null)).toEqual([]);
  });
});

describe('gradeMista', () => {
  it('normal + especial na mesma linha = mista', () => {
    expect(gradeMista(PROD, { M: 10, G3: 5 })).toBe(true);
  });
  it('só especial NÃO é mista — a linha já é a faixa', () => {
    expect(gradeMista(PROD, { G3: 10 })).toBe(false);
    expect(gradeMista(PROD, { G1: 2, G3: 10 })).toBe(false);
  });
  it('só normal não é mista', () => {
    expect(gradeMista(PROD, { M: 50, G: 50 })).toBe(false);
  });
  it('tamanho zerado não conta como presente', () => {
    expect(gradeMista(PROD, { M: 0, G3: 10 })).toBe(false);
    expect(gradeMista(PROD, { M: 10, G3: 0 })).toBe(false);
  });
  it('produto sem faixa especial nunca é misto', () => {
    expect(gradeMista(SEM_ESP, { M: 10, G3: 5 })).toBe(false);
    expect(gradeMista(null, { M: 10, G3: 5 })).toBe(false);
  });
});

describe('subtotalDaGrade', () => {
  it('PV187 item 1: grade só de G3 usa o preço DIGITADO, não o do cadastro', () => {
    // Era aqui que 10 x R$ 40,00 virava 10 x R$ 35,00.
    expect(subtotalDaGrade(PROD, D(40), { G3: 10 }, 10).toFixed(2)).toBe('400.00');
  });

  it('PV187 item 2: grade normal, preço digitado (o que já funcionava)', () => {
    expect(subtotalDaGrade(PROD, D(38), { M: 50, G: 50 }, 100).toFixed(2)).toBe('3800.00');
  });

  it('grade MISTA mantém as duas faixas: normais no digitado, grandes no cadastro', () => {
    // 10 x 38 (M) + 5 x 35 (G3, do cadastro) = 555,00
    expect(subtotalDaGrade(PROD, D(38), { M: 10, G3: 5 }, 15).toFixed(2)).toBe('555.00');
  });

  it('produto sem faixa especial: tudo no preço digitado', () => {
    expect(subtotalDaGrade(SEM_ESP, D(29), { M: 10, G3: 5 }, 15).toFixed(2)).toBe('435.00');
  });

  it('item livre (sem produto) e sem grade: preço x quantidade', () => {
    expect(subtotalDaGrade(null, D(32), null, 99).toFixed(2)).toBe('3168.00');
  });

  it('centavos não se perdem', () => {
    expect(subtotalDaGrade(PROD, D(33.33), { G3: 3 }, 3).toFixed(2)).toBe('99.99');
  });
});

describe('precoDoTamanho', () => {
  it('linha de uma faixa só: devolve o preço da linha, mesmo em tamanho ★', () => {
    expect(precoDoTamanho(PROD, D(40), 'G3', false).toFixed(2)).toBe('40.00');
  });
  it('linha mista: o ★ vem do cadastro e o normal da linha', () => {
    expect(precoDoTamanho(PROD, D(40), 'G3', true).toFixed(2)).toBe('35.00');
    expect(precoDoTamanho(PROD, D(40), 'M', true).toFixed(2)).toBe('40.00');
  });
  it('tamanho em minúscula também casa a faixa', () => {
    expect(precoDoTamanho(PROD, D(40), 'g3', true).toFixed(2)).toBe('35.00');
  });
});
