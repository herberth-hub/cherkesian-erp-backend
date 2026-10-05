/**
 * O FRETE cobrado do destinatário integra a BASE DE CÁLCULO do ICMS
 * (LC 87/96, art. 13 §1º II "a").
 *
 * Até out/2026 o emissor punha o frete só no total da nota e deixava a vBC com o
 * valor dos produtos. A Consigaz cobrou complemento de ICMS das NFs 2727 a 2735
 * porque isso travava a liberação do DIFAL da base de Duque de Caxias.
 *
 * Os números abaixo são os da NF 1/002727 real (XML autorizado).
 */
import { NfeService } from './nfe.service';
import { Prisma } from '@prisma/client';

const FILIAL = {
  id: 3, empresaId: 1, nome: 'HC QUALITY', cnpj: '45704956000102',
  nfeSerie: '1', nfeProximoNumero: 9000, nfeAmbiente: null,
  regimeTributario: 'lucro_real', crt: 3, icmsCstPadrao: '00', pisCofinsCst: '01',
  icmsAliquota: 18, pisAliquota: 1.65, cofinsAliquota: 7.6,
  logradouro: 'AV TESTE', numeroEndereco: '1', bairro: 'C', municipio: 'BARUERI',
  codMunicipio: '3505708', uf: 'SP', cep: '06400000', inscricaoEstadual: '1',
};
const DEST = {
  id: 9, nome: 'CONSIGAZ BASE DUQUE DE CAXIAS', cnpjCpf: '01597589000977',
  inscricaoEstadual: '87100227', indicadorIE: 1,
  logradouro: 'AV X', numeroEndereco: 'S/N', bairro: 'VILA', municipio: 'DUQUE DE CAXIAS',
  codMunicipio: '3301702', uf: 'RJ', cep: '25000000',
};

function servico() {
  const prisma = {
    produto: { findMany: () => Promise.resolve([]) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
    transportadora: { findUnique: () => Promise.resolve(null) },
  };
  return new NfeService(prisma as never, { get: () => undefined } as never, {} as never);
}
const montar = (svc: NfeService, itens: Array<{ q: number; v: number }>, frete: number) =>
  (svc as unknown as { montarPayload: (...a: unknown[]) => Promise<Record<string, unknown>> }).montarPayload(
    FILIAL, DEST, { pecas: 1 },
    itens.map((x, i) => ({ produtoId: null, descricao: 'ITEM ' + i, quantidade: x.q, valorUnit: new Prisma.Decimal(x.v) })),
    '1', 9000, new Prisma.Decimal(itens.reduce((s, x) => s + x.q * x.v, 0) + frete), undefined,
    { valorFrete: frete, frete: 0 },
  );

describe('ICMS — o frete entra na base de cálculo', () => {
  it('NF 2727: produtos 741,60 + frete 83,36 => vBC 824,96 (e não 741,60)', async () => {
    const pay = await montar(servico(), [{ q: 6, v: 123.6 }], 83.36);
    const it = (pay.items as Array<Record<string, number>>)[0];
    expect(it.valor_bruto).toBeCloseTo(741.6, 2);   // vProd continua só mercadoria
    expect(it.valor_frete).toBeCloseTo(83.36, 2);
    expect(it.icms_base_calculo).toBeCloseTo(824.96, 2); // <= o que a Consigaz cobrou
    // SP -> RJ é interestadual: 12%, não os 18% internos. É a alíquota da nota real.
    expect(it.icms_aliquota).toBe(12);
    expect(it.icms_valor).toBeCloseTo(824.96 * 0.12, 2); // 98,995 -> 99,00
    // a nota original destacou 89,00 (base 741,60); a diferença é o complemento devido
    expect(Number((it.icms_valor - 89).toFixed(2))).toBeCloseTo(10.0, 2);
  });

  it('rateia o frete entre os itens e a soma das bases fecha com produtos + frete', async () => {
    const pay = await montar(servico(), [{ q: 1, v: 300 }, { q: 1, v: 100 }], 40);
    const its = pay.items as Array<Record<string, number>>;
    const somaProd = its.reduce((s, i) => s + i.valor_bruto, 0);
    const somaFrete = its.reduce((s, i) => s + (i.valor_frete || 0), 0);
    const somaBase = its.reduce((s, i) => s + i.icms_base_calculo, 0);
    expect(somaProd).toBeCloseTo(400, 2);
    expect(somaFrete).toBeCloseTo(40, 2);          // rateio não perde centavo
    expect(somaBase).toBeCloseTo(440, 2);          // base = produtos + frete
    expect(its[0].icms_base_calculo).toBeCloseTo(330, 2); // 300 + 30 (proporcional)
  });

  it('sem frete, a base continua sendo só a mercadoria', async () => {
    const pay = await montar(servico(), [{ q: 2, v: 50 }], 0);
    const it = (pay.items as Array<Record<string, number>>)[0];
    expect(it.icms_base_calculo).toBeCloseTo(100, 2);
    expect(it.valor_frete).toBeUndefined();
  });

  it('PIS/COFINS saem sobre a base COM frete, menos o ICMS (Tema 69)', async () => {
    const pay = await montar(servico(), [{ q: 6, v: 123.6 }], 83.36);
    const it = (pay.items as Array<Record<string, number>>)[0];
    const esperado = Number((824.96 - it.icms_valor).toFixed(2));
    expect(it.pis_base_calculo).toBeCloseTo(esperado, 2);
    expect(it.cofins_base_calculo).toBeCloseTo(esperado, 2);
  });
});
