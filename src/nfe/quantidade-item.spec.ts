/**
 * A NOTA DE R$ 0,12 — 16/11/2026.
 *
 * NF-e avulsa da YEREVAN para o MEMORIAL HOSPITAL: duas linhas da Calça
 * Hospitalar Cós Elástico a R$ 40,50. O formulário mostrou quantidade 0,001 e
 * 0,002, totalizou R$ 0,04 + R$ 0,08 = R$ 0,12 e estava pronto para emitir.
 *
 * A multiplicação estava certa. O erro era a QUANTIDADE: o campo é
 * `<input type="number">` com passo 0,001, e a rodinha do mouse mexe nele sem
 * ninguém digitar nada. Nada entre o formulário e a SEFAZ achou estranho
 * vender 0,001 peça.
 *
 * Estes testes guardam a trava: unidade que conta peça exige inteiro; unidade
 * de medida (tecido em metro, aviamento em quilo) continua aceitando fração.
 */
import { conferirQuantidadeItem, conferirQuantidades, contaPecas, qtdTexto, quantidadeInteira } from './quantidade-item';

const CALCA = 'Calça Hospitalar Cós Elástico Unissex - Linha 6 Cores';

describe('quantidade do item da nota', () => {
  describe('o caso real', () => {
    it('0,001 peça é recusado', () => {
      const m = conferirQuantidadeItem({ descricao: CALCA, quantidade: 0.001, unidade: 'UN' });
      expect(m).toContain('0,001');
      expect(m).toContain('UN');
    });

    it('as duas linhas da nota são apontadas de uma vez', () => {
      const probs = conferirQuantidades([
        { descricao: CALCA, quantidade: 0.001, unidade: 'UN' },
        { descricao: CALCA, quantidade: 0.002, unidade: 'UN' },
      ]);
      expect(probs).toHaveLength(2);
    });

    it('com as quantidades certas (1 e 2) passa', () => {
      expect(conferirQuantidades([
        { descricao: CALCA, quantidade: 1, unidade: 'UN' },
        { descricao: CALCA, quantidade: 2, unidade: 'UN' },
      ])).toEqual([]);
    });
  });

  describe('o que conta peça', () => {
    it.each(['UN', 'un', 'UN.', ' Un ', 'PC', 'PÇ', 'PAR', 'CX', 'KIT', 'PCT', 'DZ'])('%s conta peça', (u) => {
      expect(contaPecas(u)).toBe(true);
    });

    /** Item avulso sem produto cadastrado: o formulário manda UN. */
    it('unidade vazia ou nula conta como UN', () => {
      expect(contaPecas('')).toBe(true);
      expect(contaPecas(null)).toBe(true);
      expect(contaPecas(undefined)).toBe(true);
    });

    it.each(['M', 'M2', 'KG', 'L', 'G', 'ML', 'MT'])('%s é medida, aceita fração', (u) => {
      expect(contaPecas(u)).toBe(false);
    });
  });

  describe('medida continua podendo ser fracionada', () => {
    it('tecido em metro: 12,5 M passa', () => {
      expect(conferirQuantidadeItem({ descricao: 'MALHA PV 100M', quantidade: 12.5, unidade: 'M' })).toBeNull();
    });

    it('aviamento em quilo: 0,75 KG passa', () => {
      expect(conferirQuantidadeItem({ descricao: 'LINHA', quantidade: 0.75, unidade: 'KG' })).toBeNull();
    });
  });

  describe('quantidade sem sentido', () => {
    it('zero é recusado', () => {
      expect(conferirQuantidadeItem({ descricao: CALCA, quantidade: 0, unidade: 'UN' })).toContain('inválida');
    });

    it('negativo é recusado', () => {
      expect(conferirQuantidadeItem({ descricao: CALCA, quantidade: -3, unidade: 'UN' })).toContain('inválida');
    });

    it('NaN é recusado', () => {
      expect(conferirQuantidadeItem({ descricao: CALCA, quantidade: Number.NaN, unidade: 'UN' })).toContain('inválida');
    });

    it('fração em metro também é recusada quando é zero', () => {
      expect(conferirQuantidadeItem({ descricao: 'MALHA', quantidade: 0, unidade: 'M' })).toContain('inválida');
    });
  });

  describe('inteiro com tolerância de ponto flutuante', () => {
    it('0,1 + 0,2 vezes 10 ainda é 3', () => {
      expect(quantidadeInteira((0.1 + 0.2) * 10)).toBe(true);
    });

    it('1000 peças é inteiro', () => {
      expect(quantidadeInteira(1000)).toBe(true);
    });

    it('2,5 não é', () => {
      expect(quantidadeInteira(2.5)).toBe(false);
    });
  });

  describe('a mensagem é legível por quem está emitindo', () => {
    it('mostra a quantidade com vírgula, como aparece na tela', () => {
      expect(qtdTexto(0.002)).toBe('0,002');
      expect(qtdTexto(3)).toBe('3');
    });

    it('diz o que fazer quando o produto é mesmo vendido por metragem', () => {
      const m = conferirQuantidadeItem({ descricao: 'TECIDO', quantidade: 0.5, unidade: 'UN' });
      expect(m).toContain('unidade comercial');
    });

    it('nomeia o item, para achar a linha errada numa nota de 20 itens', () => {
      const m = conferirQuantidadeItem({ descricao: CALCA, quantidade: 0.001, unidade: 'UN' });
      expect(m).toContain('Calça Hospitalar');
    });

    it('item sem descrição não quebra a mensagem', () => {
      expect(conferirQuantidadeItem({ descricao: '', quantidade: 0.5, unidade: 'UN' })).toContain('item sem descrição');
    });
  });

  it('nota inteira correta não devolve problema nenhum', () => {
    expect(conferirQuantidades([
      { descricao: CALCA, quantidade: 30, unidade: 'UN' },
      { descricao: 'MALHA PV', quantidade: 48.75, unidade: 'M' },
      { descricao: 'CAIXA', quantidade: 2, unidade: 'CX' },
    ])).toEqual([]);
  });
});
