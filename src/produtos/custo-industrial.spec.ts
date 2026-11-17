/**
 * O RATEIO DO CUSTO INDUSTRIAL.
 *
 * Os números aqui são os do contas a pagar real de ago-out/2026, com as
 * categorias como elas estão escritas no banco — "FOLHA DE PAGAMENTO",
 * "MATÉRIA PRIMA" e "Matéria-prima" convivendo. Se o casamento de categoria
 * quebrar, e um gasto de material cair no rateio, o tecido passa a ser contado
 * duas vezes e ninguém percebe olhando o total.
 */
import { aliquotaDeVenda, baldeDaCategoria, ratearCustoIndustrial } from './custo-industrial';

/** Como está no banco em 17/11/2026, ago-out. */
const REAIS = [
  { categoria: 'FOLHA DE PAGAMENTO', total: 131810.58 },
  { categoria: 'FACÇÃO', total: 102822.37 },
  { categoria: 'Matéria-prima', total: 94595.14 },
  { categoria: 'IMPOSTOS', total: 30627.29 },
  { categoria: 'MATÉRIA PRIMA', total: 24671.24 },
  { categoria: 'FACTORING', total: 20300.0 },
  { categoria: 'Aluguel', total: 17040.0 },
  { categoria: 'PRONAMPE - EMPRESTIMO', total: 10627.34 },
  { categoria: 'Plano de Saúde', total: 9913.26 },
  { categoria: 'Contabilidade', total: 9240.0 },
  { categoria: 'Aviamento', total: 6492.74 },
  { categoria: 'Facção', total: 6083.8 },
  { categoria: 'Salário', total: 5900.0 },
  { categoria: 'Facção / Mão de obra', total: 633.0 },
];

describe('em que balde cada despesa cai', () => {
  it('folha, aluguel e contabilidade sao custo industrial', () => {
    for (const c of ['FOLHA DE PAGAMENTO', 'Salário', 'Aluguel', 'Contabilidade', 'Plano de Saúde', 'TELEFONE/INTERNET']) {
      expect(baldeDaCategoria(c)).toBe('industrial');
    }
  });

  it('as tres grafias de faccao caem juntas', () => {
    for (const c of ['FACÇÃO', 'Facção', 'Facção / Mão de obra']) expect(baldeDaCategoria(c)).toBe('faccao');
  });

  it('material fica de FORA — ele ja esta na BOM', () => {
    for (const c of ['Matéria-prima', 'MATÉRIA PRIMA', 'Aviamento', 'Aviamentos', 'Tecido']) {
      expect(baldeDaCategoria(c)).toBe('direto');
    }
  });

  it('imposto e financeiro nao sao custo de fabricar', () => {
    expect(baldeDaCategoria('IMPOSTOS')).toBe('imposto');
    expect(baldeDaCategoria('DARE-SP')).toBe('imposto');
    expect(baldeDaCategoria('FACTORING')).toBe('financeiro');
    expect(baldeDaCategoria('PRONAMPE - EMPRESTIMO')).toBe('financeiro');
    expect(baldeDaCategoria('ACORDOS/DIVIDAS')).toBe('financeiro');
  });

  it('categoria nova e desconhecida cai em industrial, o destino conservador', () => {
    expect(baldeDaCategoria('ALGO QUE NINGUEM VIU AINDA')).toBe('industrial');
    expect(baldeDaCategoria('')).toBe('industrial');
  });
});

describe('o rateio', () => {
  const r = ratearCustoIndustrial({ despesas: REAIS, pecas: 7310, faturamento: 900000 });

  it('rateia folha + overhead, e so', () => {
    // 131810.58 + 17040 + 9913.26 + 9240 + 5900
    expect(r.industrial).toBeCloseTo(173903.84, 2);
  });

  it('a faccao fica de fora, somada a parte', () => {
    expect(r.fora.faccao).toBeCloseTo(109539.17, 2);
  });

  it('o material fica de fora — contar duas vezes era o risco', () => {
    // 94595,14 + 24671,24 (as duas grafias de materia-prima) + 6492,74 de aviamento
    expect(r.fora.direto).toBeCloseTo(125759.12, 2);
  });

  it('chega no custo por peca', () => {
    expect(r.custoPorPeca).toBeCloseTo(23.79, 2);
  });

  it('e no percentual do faturamento, que e como se enxerga o peso da fabrica', () => {
    expect(r.percentualDoFaturamento).toBeCloseTo(19.32, 2);
  });

  it('tudo que entrou e tudo que saiu fecha com o total lancado', () => {
    const lancado = REAIS.reduce((s, d) => s + d.total, 0);
    const somado = r.industrial + r.fora.direto + r.fora.faccao + r.fora.imposto + r.fora.financeiro;
    expect(somado).toBeCloseTo(lancado, 2);
  });
});

describe('quando o numero nao e confiavel, ele diz', () => {
  it('sem producao no periodo nao inventa custo — devolve null, nao Infinity', () => {
    const r = ratearCustoIndustrial({ despesas: REAIS, pecas: 0 });
    expect(r.custoPorPeca).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/sem base para ratear/i);
  });

  it('OP baixada sem etiqueta e avisada: ela infla o custo por peca', () => {
    const r = ratearCustoIndustrial({ despesas: REAIS, pecas: 7310, opsSemEtiqueta: 71 });
    expect(r.avisos.join(' ')).toMatch(/71 OP\(s\).*sem etiqueta/i);
    expect(r.avisos.join(' ')).toMatch(/sai mais alto/i);
  });

  it('entrada manual maior que a producao e apontada, com o numero que daria', () => {
    const r = ratearCustoIndustrial({ despesas: REAIS, pecas: 7310, entradasManuais: 12065 });
    // 173903,84 / (7310 + 12065) = 8,98
    expect(r.avisos.join(' ')).toMatch(/8,98/);
    expect(r.avisos.join(' ')).toMatch(/Se forem revenda, o número ao lado está certo/);
  });

  it('entrada manual menor que a producao nao vira alarme', () => {
    expect(ratearCustoIndustrial({ despesas: REAIS, pecas: 7310, entradasManuais: 100 }).avisos.join(' ')).not.toMatch(/denominador/);
  });

  it('sem faturamento informado, o percentual e null — nao zero', () => {
    expect(ratearCustoIndustrial({ despesas: REAIS, pecas: 100 }).percentualDoFaturamento).toBeNull();
  });
});

describe('a aliquota de venda sai do CNPJ que emite', () => {
  it('Yerevan, Simples: a estimativa que a tela ja usava', () => {
    const a = aliquotaDeVenda({ regimeTributario: 'simples' });
    expect(a.aliquota).toBe(5.93);
    expect(a.origem).toMatch(/estimativa/i);
  });

  it('Cherkesian, presumido: PIS 0,65 + COFINS 3,00', () => {
    expect(aliquotaDeVenda({ regimeTributario: 'lucro_presumido', pisAliquota: 0.65, cofinsAliquota: 3 }).aliquota).toBeCloseTo(3.65, 4);
  });

  it('HC Quality, real: PIS 1,65 + COFINS 7,60', () => {
    const a = aliquotaDeVenda({ regimeTributario: 'lucro_real', pisAliquota: 1.65, cofinsAliquota: 7.6 });
    expect(a.aliquota).toBeCloseTo(9.25, 4);
    expect(a.origem).toMatch(/Lucro Real/);
  });

  it('o ICMS nao entra, e a tela diz por que', () => {
    expect(aliquotaDeVenda({ regimeTributario: 'lucro_real', pisAliquota: 1.65, cofinsAliquota: 7.6 }).origem).toMatch(/ICMS/);
  });

  it('filial sem aliquota cadastrada nao vira imposto zero', () => {
    expect(aliquotaDeVenda({ regimeTributario: 'lucro_presumido' }).aliquota).toBe(5.93);
    expect(aliquotaDeVenda(null).aliquota).toBe(5.93);
  });
});
