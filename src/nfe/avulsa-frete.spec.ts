/**
 * Frete na NF-e avulsa: tem que entrar no TOTAL da nota, na DUPLICATA e no
 * payload da SEFAZ. Antes de out/2026 a rota avulsa não tinha frete nenhum —
 * quem precisava cobrar entrega não conseguia emitir a nota certa.
 */
import { NfeService } from './nfe.service';

const FILIAL = {
  id: 3, empresaId: 1, nome: 'HC QUALITY', cnpj: '45704956000102', matriz: true,
  nfeSerie: '1', nfeProximoNumero: 2812, nfeAmbiente: null,
  focusToken: null, focusTokenProd: null, focusTokenHomolog: null,
  regimeTributario: 'lucro_real', crt: 3, icmsCstPadrao: '00', pisCofinsCst: '01',
  logradouro: 'AV TESTE', numeroEndereco: '100', bairro: 'CENTRO',
  municipio: 'BARUERI', codMunicipio: '3505708', uf: 'SP', cep: '06400000',
  inscricaoEstadual: '123456789', icmsAliquota: 18,
};
const CLIENTE = {
  id: 9, empresaId: 1, nome: 'CLIENTE TESTE LTDA', cnpjCpf: '03968404000161',
  inscricaoEstadual: 'ISENTO', indicadorIE: 9,
  logradouro: 'R X', numeroEndereco: '1', bairro: 'B', municipio: 'SAO PAULO',
  codMunicipio: '3550308', uf: 'SP', cep: '01000000', email: null,
};

function servico() {
  const gravado: { nota?: Record<string, unknown>; receber: Array<Record<string, unknown>> } = { receber: [] };
  const tx = {
    notaFiscal: { create: ({ data }: { data: Record<string, unknown> }) => { gravado.nota = data; return Promise.resolve({ id: 1, ...data }); } },
    filial: { update: () => Promise.resolve({}) },
    contaReceber: { create: ({ data }: { data: Record<string, unknown> }) => { gravado.receber.push(data); return Promise.resolve(data); } },
    pedido: { update: () => Promise.resolve({}) },
  };
  const prisma = {
    cliente: { findUnique: () => Promise.resolve(CLIENTE) },
    filial: { findUnique: () => Promise.resolve(FILIAL), findFirst: () => Promise.resolve(FILIAL) },
    produto: { findMany: () => Promise.resolve([]), findUnique: () => Promise.resolve(null) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
    transportadora: { findUnique: () => Promise.resolve(null) },
    $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  const svc = new NfeService(prisma as never, { get: () => undefined } as never, {} as never);
  return { svc, gravado };
}

const ITENS = [{ descricao: 'CAMISETA', ncm: '61091000', quantidade: 10, valorUnit: 50 }]; // 500,00

describe('NF-e avulsa — frete', () => {
  it('soma o frete ao total da nota e à duplicata', async () => {
    const { svc, gravado } = servico();
    const r = (await svc.emitirAvulsa(
      { clienteId: 9, filialId: 3, itens: ITENS, valorFrete: 120.5, diasVencimento: 30 },
      1, 'herberth',
    )) as Record<string, unknown>;

    // total da nota = 500,00 de itens + 120,50 de frete
    expect(Number(gravado.nota!.valor)).toBeCloseTo(620.5, 2);
    // a duplicata cobra o total COM frete — senão o cliente paga a menos
    expect(gravado.receber).toHaveLength(1);
    expect(Number(gravado.receber[0].valor)).toBeCloseTo(620.5, 2);

    const pay = (r.payloadPreview ?? {}) as Record<string, unknown>;
    expect(pay.valor_frete).toBeCloseTo(120.5, 2);
    expect(pay.valor_total).toBeCloseTo(620.5, 2);
    expect(pay.modalidade_frete).toBe(0); // com frete e sem modalidade informada => CIF
  });

  it('sem frete, nada muda e a modalidade fica 9 (sem transporte)', async () => {
    const { svc, gravado } = servico();
    const r = (await svc.emitirAvulsa({ clienteId: 9, filialId: 3, itens: ITENS, diasVencimento: 30 }, 1, 'herberth')) as Record<string, unknown>;
    expect(Number(gravado.nota!.valor)).toBeCloseTo(500, 2);
    expect(Number(gravado.receber[0].valor)).toBeCloseTo(500, 2);
    const pay = (r.payloadPreview ?? {}) as Record<string, unknown>;
    expect(pay.valor_frete).toBeUndefined();
    expect(pay.modalidade_frete).toBe(9);
  });

  it('respeita a modalidade informada (FOB)', async () => {
    const { svc } = servico();
    const r = (await svc.emitirAvulsa(
      { clienteId: 9, filialId: 3, itens: ITENS, valorFrete: 80, modalidadeFrete: 1 },
      1, 'herberth',
    )) as Record<string, unknown>;
    expect(((r.payloadPreview ?? {}) as Record<string, unknown>).modalidade_frete).toBe(1);
  });

  it('BONIFICAÇÃO ignora o frete — a nota inteira é sem cobrança', async () => {
    const { svc, gravado } = servico();
    await svc.emitirAvulsa(
      { clienteId: 9, filialId: 3, itens: ITENS, valorFrete: 999, bonificacao: true, diasVencimento: 30 },
      1, 'herberth',
    );
    expect(Number(gravado.nota!.valor)).toBeCloseTo(500, 2); // sem o frete
    expect(gravado.receber).toHaveLength(0); // e sem conta a receber
  });

  it('recusa frete negativo', async () => {
    const { svc } = servico();
    await expect(
      svc.emitirAvulsa({ clienteId: 9, filialId: 3, itens: ITENS, valorFrete: -5 }, 1, 'herberth'),
    ).rejects.toThrow(/frete não pode ser negativo/i);
  });
});
