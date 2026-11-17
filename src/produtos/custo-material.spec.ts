/**
 * O CUSTO DO TECIDO.
 *
 * O caso que originou tudo: PRD-CAM-0085 (CAMISETA GOLA V M.L C/ FAIXA
 * REFLETIVA). Tecido MP-TEC-0041, HELANCA POLIÉSTER, comprada a R$ 25,40 o
 * QUILO, largura 1,70 m, gramatura 218 g/m². A receita consome 1,11 METROS no
 * tamanho G. A tela mostrava R$ 28,19 de tecido; o custo real é R$ 10,45.
 *
 * Os números deste arquivo são os do cadastro real, de propósito: se alguém
 * mexer na conversão e o teste continuar passando com outro resultado, o teste
 * não estava provando nada.
 */
import { consumoSuspeito, custoDaLinha, kgPorMetro, normalizarUnidade } from './custo-material';

/** MP-TEC-0041, como está no banco. */
const HELANCA = { unidade: 'KG', custo: '25.4', largura: '1.7', gramatura: '218' };
/** AVI-REF-0001 — fita refletiva: vendida e consumida no mesmo metro. */
const FITA = { unidade: 'm', custo: '1.30' };

describe('normalizar a unidade', () => {
  it('junta as grafias de metro', () => {
    for (const u of ['m', 'M', 'mt', 'MT', 'Metros', ' m ']) expect(normalizarUnidade(u)).toBe('M');
  });

  it('junta as grafias de quilo', () => {
    for (const u of ['kg', 'KG', 'Kg', 'quilo']) expect(normalizarUnidade(u)).toBe('KG');
  });

  it('unidade vazia não vira nada — não se inventa metro', () => {
    expect(normalizarUnidade(null)).toBe('');
    expect(normalizarUnidade('  ')).toBe('');
  });
});

describe('quilos por metro linear', () => {
  it('sai de largura x gramatura', () => {
    expect(kgPorMetro(HELANCA)).toBeCloseTo(0.3706, 4);
  });

  it('sem gramatura, não há conversão — e isso é null, não zero', () => {
    expect(kgPorMetro({ unidade: 'KG', largura: '1.7' })).toBeNull();
    expect(kgPorMetro({ unidade: 'KG' })).toBeNull();
  });
});

describe('o custo de uma linha da receita', () => {
  it('metro de receita x preço por quilo: converte antes de multiplicar', () => {
    const l = custoDaLinha({ quantidade: 1.11, unidadeReceita: 'm', material: HELANCA });
    expect(l.quantidade).toBeCloseTo(0.4114, 4); // kg
    expect(l.unidade).toBe('KG');
    expect(l.subtotal).toBeCloseTo(10.45, 2);
    expect(l.aviso).toBeNull();
  });

  it('o erro que havia: multiplicar direto dava quase 3x', () => {
    const direto = 1.11 * 25.4;
    const certo = custoDaLinha({ quantidade: 1.11, unidadeReceita: 'm', material: HELANCA }).subtotal!;
    expect(direto).toBeCloseTo(28.19, 2);
    expect(direto / certo).toBeCloseTo(2.698, 2); // o rendimento do artigo, em m/kg
  });

  it('mesma unidade nos dois lados: multiplicação direta', () => {
    const l = custoDaLinha({ quantidade: 2.23, unidadeReceita: 'm', material: FITA });
    expect(l.fator).toBe(1);
    expect(l.subtotal).toBeCloseTo(2.9, 2);
  });

  it('"m" e "Metros" são a mesma unidade — não converte nada', () => {
    const l = custoDaLinha({ quantidade: 1.13, unidadeReceita: 'm', material: { unidade: 'Metros', custo: '9.00' } });
    expect(l.fator).toBe(1);
    expect(l.subtotal).toBeCloseTo(10.17, 2);
  });

  it('sem largura/gramatura RECUSA o subtotal, dizendo o que preencher', () => {
    const l = custoDaLinha({ quantidade: 1.11, unidadeReceita: 'm', material: { unidade: 'kg', custo: '26.90' } });
    expect(l.subtotal).toBeNull();
    expect(l.quantidade).toBeNull();
    expect(l.aviso).toMatch(/largura e gramatura/i);
  });

  it('o caminho inverso (receita em kg, preço por metro) também converte', () => {
    const l = custoDaLinha({ quantidade: 0.4114, unidadeReceita: 'kg', material: { ...HELANCA, unidade: 'm' } });
    expect(l.quantidade).toBeCloseTo(1.11, 2);
  });

  it('unidades que não se convertem são apontadas, não arredondadas para 1', () => {
    const l = custoDaLinha({ quantidade: 2, unidadeReceita: 'un', material: { unidade: 'm', custo: '1.30' } });
    expect(l.subtotal).toBeNull();
    expect(l.aviso).toMatch(/Acerte a unidade/i);
  });

  it('material sem unidade cadastrada não vira lacuna — multiplica e segue', () => {
    const l = custoDaLinha({ quantidade: 3, unidadeReceita: 'm', material: { custo: '2' } });
    expect(l.subtotal).toBeCloseTo(6, 2);
  });

  it('grama na receita, preço por quilo', () => {
    const l = custoDaLinha({ quantidade: 500, unidadeReceita: 'g', material: { unidade: 'kg', custo: '25.40' } });
    expect(l.quantidade).toBeCloseTo(0.5, 4);
    expect(l.subtotal).toBeCloseTo(12.7, 2);
  });

  it('custo zerado não é erro — é material sem preço, e o subtotal é zero', () => {
    const l = custoDaLinha({ quantidade: 1.11, unidadeReceita: 'm', material: { ...HELANCA, custo: '0' } });
    expect(l.subtotal).toBe(0);
    expect(l.aviso).toBeNull();
  });
});

describe('consumo fora da ordem de grandeza de uma peça', () => {
  it('99 metros por peça é apontado — foi o 99 do PP (99 cm) que custou R$ 2.514,60', () => {
    expect(consumoSuspeito(99, 'm')).toMatch(/cent[íi]metro/i);
  });

  it('o consumo normal da peça passa calado', () => {
    for (const q of [0.99, 1.11, 1.53, 2.51, 19.9]) expect(consumoSuspeito(q, 'm')).toBeNull();
  });

  it('50 botões por peça é normal — o alerta é só de metro e quilo', () => {
    expect(consumoSuspeito(50, 'un')).toBeNull();
    expect(consumoSuspeito(50, 'kg')).not.toBeNull();
  });
});
