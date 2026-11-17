/**
 * Etiqueta de composição.
 *
 * O que esta suíte protege:
 *   1. a OP SAI na etiqueta — é a rastreabilidade inteira do pedido do Herberth;
 *   2. a quantidade é a cortada, e imprimir a mais não vira dívida negativa;
 *   3. etiqueta sem composição não passa calada: o sistema avisa antes.
 */
import {
  conferirEtiqueta, DadosEtiquetaComposicao, faltamImprimir, formatarCnpj,
  montarZplComposicao, quebrarLinhas, recadoPendencia, rotuloTamanho, totalFaltante,
} from './etiqueta-composicao';

const DADOS = (over: Partial<DadosEtiquetaComposicao> = {}): DadosEtiquetaComposicao => ({
  fabricante: {
    nome: 'QUALITY CORPORATE',
    cnpj: '45704956000102',
    telefone: '(11) 5555-7967',
    site: 'WWW.HCQUALITYCORP.COM.BR',
  },
  op: 'OP-0256',
  codigoProduto: 'PRD-JAL-0014',
  descricaoProduto: 'JALECO UNISSEX',
  composicao: '100% POLIESTER',
  tamanho: 'M',
  quantidade: 25,
  data: new Date('2026-11-13T12:00:00Z'),
  ...over,
});

describe('o que a etiqueta tem de trazer', () => {
  it('traz o NÚMERO DA OP — sem isso não há rastreio', () => {
    expect(montarZplComposicao(DADOS())).toContain('OP-0256');
  });

  it('traz composição, CNPJ formatado, tamanho e origem', () => {
    const z = montarZplComposicao(DADOS());
    expect(z).toContain('100% POLIESTER');
    expect(z).toContain('45.704.956/0001-02');
    expect(z).toContain('TAMANHO');
    expect(z).toContain('FABRICADO NO BRASIL');
  });

  it('o QR carrega OP, produto, tamanho e data', () => {
    const z = montarZplComposicao(DADOS());
    expect(z).toContain('^BQN');
    expect(z).toContain('"op":"OP-0256"');
    expect(z).toContain('"tam":"M"');
    expect(z).toContain('"data":"2026-11-13"');
  });

  it('manda a impressora repetir UMA etiqueta por peça', () => {
    expect(montarZplComposicao(DADOS({ quantidade: 25 }))).toContain('^PQ25');
    expect(montarZplComposicao(DADOS({ quantidade: 1 }))).toContain('^PQ1');
  });

  it('quantidade zero ou quebrada nunca vira ^PQ0 (a impressora não pararia)', () => {
    expect(montarZplComposicao(DADOS({ quantidade: 0 }))).toContain('^PQ1');
    expect(montarZplComposicao(DADOS({ quantidade: 2.7 }))).toContain('^PQ2');
  });

  it('abre e fecha o formato ZPL', () => {
    const z = montarZplComposicao(DADOS());
    expect(z.startsWith('^XA')).toBe(true);
    expect(z.trim().endsWith('^XZ')).toBe(true);
  });

  /** `^` e `~` são comandos do ZPL: se passarem como dado, quebram a etiqueta. */
  it('não deixa caractere de comando entrar como texto', () => {
    const z = montarZplComposicao(DADOS({ composicao: '50% ALGO^DAO ~ 50% PES', op: 'OP-^99' }));
    // O dado de cada campo é o que vai entre ^FD e ^FS. Nenhum pode conter
    // `^` nem `~`, ou a impressora lê aquilo como um comando novo.
    const campos = [...z.matchAll(/\^FD([\s\S]*?)\^FS/g)].map((m) => m[1]);
    expect(campos.length).toBeGreaterThan(5);
    for (const c of campos) expect(c).not.toMatch(/[\^~]/);
    expect(z).not.toContain('ALGO^DAO');
  });

  it('OP sem grade imprime "ÚNICO" no lugar do tamanho vazio', () => {
    expect(montarZplComposicao(DADOS({ tamanho: '' }))).toContain('ÚNICO');
  });

  it('composição não cadastrada é dita na etiqueta, não some', () => {
    expect(montarZplComposicao(DADOS({ composicao: null }))).toContain('COMPOSICAO NAO CADASTRADA');
  });
});

describe('conferência antes de gastar fita', () => {
  it('etiqueta completa não tem problema', () => {
    expect(conferirEtiqueta(DADOS())).toEqual([]);
  });

  it('avisa quando falta composição, CNPJ ou número da OP', () => {
    expect(conferirEtiqueta(DADOS({ composicao: '   ' }))[0]).toMatch(/composição/i);
    expect(conferirEtiqueta(DADOS({ fabricante: { nome: 'X', cnpj: null } }))[0]).toMatch(/CNPJ/i);
    expect(conferirEtiqueta(DADOS({ op: '' })).join(' ')).toMatch(/sem número/i);
  });

  it('avisa quantidade inválida', () => {
    expect(conferirEtiqueta(DADOS({ quantidade: 0 })).join(' ')).toMatch(/quantidade/i);
  });
});

describe('quanto ainda falta imprimir', () => {
  it('conta por tamanho o que foi cortado e não impresso', () => {
    const r = faltamImprimir([
      { tamanho: 'P', devidas: 10, impressas: 0 },
      { tamanho: 'M', devidas: 20, impressas: 20 },
      { tamanho: 'G', devidas: 8, impressas: 3 },
    ]);
    expect(r).toEqual([{ tamanho: 'P', faltam: 10 }, { tamanho: 'G', faltam: 5 }]);
    expect(totalFaltante([{ tamanho: 'P', devidas: 10, impressas: 0 }, { tamanho: 'G', devidas: 8, impressas: 3 }])).toBe(15);
  });

  /** Etiqueta rasga e é reimpressa. Isso não pode virar pendência negativa. */
  it('imprimir A MAIS não vira dívida negativa', () => {
    expect(faltamImprimir([{ tamanho: 'M', devidas: 20, impressas: 23 }])).toEqual([]);
    expect(totalFaltante([{ tamanho: 'M', devidas: 20, impressas: 23 }])).toBe(0);
  });

  it('OP sem nada devido não tem pendência', () => {
    expect(faltamImprimir([])).toEqual([]);
    expect(totalFaltante([])).toBe(0);
  });

  it('o recado da trava diz o número exato que falta, por tamanho', () => {
    const msg = recadoPendencia('OP-0256', [
      { tamanho: 'P', devidas: 10, impressas: 0 },
      { tamanho: 'G', devidas: 8, impressas: 3 },
    ]);
    expect(msg).toContain('OP-0256');
    expect(msg).toContain('15 etiqueta');
    expect(msg).toContain('P: 10');
    expect(msg).toContain('G: 5');
  });
});

describe('miudezas que quebram etiqueta', () => {
  it('CNPJ com 14 dígitos é formatado; o resto passa como veio', () => {
    expect(formatarCnpj('45704956000102')).toBe('45.704.956/0001-02');
    expect(formatarCnpj('45.704.956/0001-02')).toBe('45.704.956/0001-02');
    expect(formatarCnpj('123')).toBe('123');
    expect(formatarCnpj(null)).toBe('');
  });

  it('rótulo do tamanho', () => {
    expect(rotuloTamanho('M')).toBe('M');
    expect(rotuloTamanho('')).toBe('ÚNICO');
    expect(rotuloTamanho('  ')).toBe('ÚNICO');
  });

  it('quebra a composição por palavra, sem cortar palavra no meio', () => {
    const l = quebrarLinhas('50% POLIESTER / 50% ALGODAO', 16, 2);
    expect(l).toEqual(['50% POLIESTER /', '50% ALGODAO']);
  });

  it('respeita o teto de linhas', () => {
    expect(quebrarLinhas('A B C D E F G H I J', 3, 2)).toHaveLength(2);
  });

  it('palavra maior que a linha é cortada, mas não trava', () => {
    expect(quebrarLinhas('POLIESTERMUITOLONGO', 8, 2)).toEqual(['POLIESTE']);
  });

  it('texto vazio não vira linha', () => {
    expect(quebrarLinhas('', 10, 2)).toEqual([]);
    expect(quebrarLinhas('   ', 10, 2)).toEqual([]);
  });
});
