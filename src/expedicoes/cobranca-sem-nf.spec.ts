/**
 * Cobrança de expedição despachada SEM NF.
 *
 * O título de contas a receber nascia só junto com a NF-e. Quem despachava sem
 * nota entregava a mercadoria e não deixava cobrança nenhuma — PV147 (R$ 1.392,00)
 * e PV125 (R$ 3.300,00) saíram assim. Esta rota lança o título a partir da própria
 * expedição, com as travas que impedem cobrar duas vezes ou cobrar brinde.
 */
import { ExpedicoesService } from './expedicoes.service';

type Criado = { valor: { toFixed: (n: number) => string }; vencimento: Date; documento: string; pedidoId: number; notaFiscalId: number | null };

const EXP = {
  id: 123, numero: 'EXP-0123', clienteId: 9, pedidoId: 147, nf: null,
  conferenciaStatus: 'despachado',
  itens: [{ quantidade: 48, valorUnit: 29 }],
};
const CLIENTE = { id: 9, empresaId: 1, nome: 'FMA PLASTICOS LTDA' };
const PEDIDO = {
  id: 147, numero: 'PV147', clienteId: 9, filialId: 3, bonificacao: false,
  formaPagamento: null as string | null, valorTotal: 1392, itens: [],
};

function servico(over: {
  exp?: Partial<typeof EXP>;
  pedido?: Partial<typeof PEDIDO>;
  titulos?: number;
  contaCnab?: { id: number; filialId: number } | null;
  remessaErro?: string;
} = {}) {
  const criados: Criado[] = [];
  const remessas: Array<{ contaBancariaId: number; ids: number[] }> = [];
  const prisma = {
    expedicao: { findUnique: () => Promise.resolve({ ...EXP, ...over.exp }) },
    cliente: { findUnique: () => Promise.resolve(CLIENTE) },
    pedido: { findUnique: () => Promise.resolve({ ...PEDIDO, ...over.pedido }) },
    contaReceber: {
      count: () => Promise.resolve(over.titulos ?? 0),
      createMany: ({ data }: { data: Criado[] }) => {
        criados.push(...data);
        return Promise.resolve({ count: data.length });
      },
      findMany: () => Promise.resolve(criados.map((_, i) => ({ id: 500 + i }))),
    },
    contaBancaria: { findFirst: () => Promise.resolve(over.contaCnab ?? null) },
    log: { create: () => Promise.resolve({}) },
  };
  const bancos = {
    gerarRemessa: (_e: number, _u: string, contaBancariaId: number, ids: number[]) => {
      if (over.remessaErro) return Promise.reject(new Error(over.remessaErro));
      remessas.push({ contaBancariaId, ids });
      return Promise.resolve({ nomeArquivo: 'CB2610151.REM', boletos: ids.length });
    },
  };
  return { svc: new ExpedicoesService(prisma as never, bancos as never), criados, remessas };
}

const soma = (c: Criado[]) => c.reduce((s, t) => s + Number(t.valor.toFixed(2)), 0);
const dia = (d: Date) => d.toISOString().slice(0, 10);

describe('lançar cobrança de expedição sem NF', () => {
  it('PV147: lança 1 título pelo valor do que foi expedido (48 × 29)', async () => {
    const { svc, criados } = servico();
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10' })) as Record<string, unknown>;
    expect(r.titulos).toBe(1);
    expect(r.valor).toBe(1392);
    expect(criados).toHaveLength(1);
    expect(dia(criados[0].vencimento)).toBe('2026-11-10');
    expect(criados[0].documento).toBe('EXP-0123');
    expect(criados[0].pedidoId).toBe(147);
    // Sem NF ainda: o título fica solto, pronto para a nota amarrar depois.
    expect(criados[0].notaFiscalId).toBeNull();
  });

  it('prazo vem da forma de pagamento do pedido quando não informam vencimento', async () => {
    const { svc, criados } = servico({ pedido: { formaPagamento: '28/42/56 dias' } });
    const r = (await svc.lancarCobranca(123, 1, 'admin', {})) as Record<string, unknown>;
    expect(r.titulos).toBe(3);
    expect(soma(criados)).toBeCloseTo(1392, 2);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const esperado = [28, 42, 56].map((n) => { const x = new Date(hoje); x.setDate(x.getDate() + n); return dia(x); });
    expect(criados.map((t) => dia(t.vencimento))).toEqual(esperado);
  });

  it('forma de pagamento informada na hora vence a do pedido', async () => {
    const { svc, criados } = servico({ pedido: { formaPagamento: '30 dias' } });
    await svc.lancarCobranca(123, 1, 'admin', { formaPagamento: '15 dias' });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const q = new Date(hoje); q.setDate(q.getDate() + 15);
    expect(criados.map((t) => dia(t.vencimento))).toEqual([dia(q)]);
  });

  it('parcelas pedidas sem prazo na forma: divide de 30 em 30 e fecha a soma no centavo', async () => {
    const { svc, criados } = servico();
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10', parcelas: 3 })) as Record<string, unknown>;
    expect(r.titulos).toBe(3);
    expect(soma(criados)).toBeCloseTo(1392, 2);
    expect(criados.map((t) => dia(t.vencimento))).toEqual(['2026-11-10', '2026-12-10', '2027-01-09']);
  });

  it('valor com dízima: a última parcela absorve a sobra (não perde centavo)', async () => {
    const { svc, criados } = servico({ exp: { itens: [{ quantidade: 1, valorUnit: 100 }] } });
    await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10', parcelas: 3 });
    expect(criados.map((t) => t.valor.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
    expect(soma(criados)).toBeCloseTo(100, 2);
  });

  it('sem vencimento e sem prazo: vence hoje (o cliente já está com a mercadoria)', async () => {
    const { svc, criados } = servico();
    await svc.lancarCobranca(123, 1, 'admin', {});
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    expect(dia(criados[0].vencimento)).toBe(dia(hoje));
  });

  it('valor informado à mão substitui o do snapshot', async () => {
    const { svc, criados } = servico();
    const r = (await svc.lancarCobranca(123, 1, 'admin', { valor: 1000, vencimento: '2026-11-10' })) as Record<string, unknown>;
    expect(r.valor).toBe(1000);
    expect(criados[0].valor.toFixed(2)).toBe('1000.00');
  });

  it('snapshot vazio: cai no valor total do pedido', async () => {
    const { svc, criados } = servico({ exp: { itens: null as never } });
    await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10' });
    expect(criados[0].valor.toFixed(2)).toBe('1392.00');
  });

  it('BONIFICAÇÃO não gera cobrança', async () => {
    const { svc, criados } = servico({ pedido: { bonificacao: true } });
    await expect(svc.lancarCobranca(123, 1, 'admin', {})).rejects.toThrow(/bonifica/i);
    expect(criados).toHaveLength(0);
  });

  it('pedido que JÁ tem título: recusa, para não cobrar duas vezes', async () => {
    const { svc, criados } = servico({ titulos: 2 });
    await expect(svc.lancarCobranca(123, 1, 'admin', {})).rejects.toThrow(/já tem 2 t/i);
    expect(criados).toHaveLength(0);
  });

  it('expedição ainda em conferência: recusa (a mercadoria não saiu)', async () => {
    const { svc, criados } = servico({ exp: { conferenciaStatus: 'conferindo' } });
    await expect(svc.lancarCobranca(123, 1, 'admin', {})).rejects.toThrow(/conferir ou despachar/i);
    expect(criados).toHaveLength(0);
  });

  it('expedição conferida (ainda não despachada) já pode ser cobrada', async () => {
    const { svc } = servico({ exp: { conferenciaStatus: 'conferida' } });
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10' })) as Record<string, unknown>;
    expect(r.titulos).toBe(1);
  });

  it('expedição avulsa (sem pedido): não há a quem cobrar', async () => {
    const { svc, criados } = servico({ exp: { pedidoId: null as never } });
    await expect(svc.lancarCobranca(123, 1, 'admin', {})).rejects.toThrow(/avulsa/i);
    expect(criados).toHaveLength(0);
  });

  it('vencimento inválido é recusado antes de escrever', async () => {
    const { svc, criados } = servico();
    await expect(svc.lancarCobranca(123, 1, 'admin', { vencimento: '31/11/2026' })).rejects.toThrow(/inválido/i);
    expect(criados).toHaveLength(0);
  });

  it('valor zero (snapshot e pedido vazios): pede o valor em vez de lançar R$ 0,00', async () => {
    const { svc, criados } = servico({ exp: { itens: [] }, pedido: { valorTotal: 0 } });
    await expect(svc.lancarCobranca(123, 1, 'admin', {})).rejects.toThrow(/valor a cobrar/i);
    expect(criados).toHaveLength(0);
  });
});

/** Boleto só onde há CNAB/convênio homologado — hoje só a Yerevan (Santander). */
describe('boleto na cobrança sem NF', () => {
  it('CNPJ com CNAB (Yerevan): lança os títulos e gera a remessa', async () => {
    const { svc, criados, remessas } = servico({ contaCnab: { id: 7, filialId: 2 } });
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10', parcelas: 2, cobrar: 'boleto' })) as Record<string, unknown>;
    expect(r.forma).toBe('boleto');
    expect(criados.map((t) => (t as unknown as { formaCobranca?: string }).formaCobranca)).toEqual(['boleto', 'boleto']);
    expect(remessas).toEqual([{ contaBancariaId: 7, ids: [500, 501] }]);
    expect(r.avisoBoleto).toBeNull();
  });

  it('CNPJ sem CNAB: recusa o boleto ANTES de lançar título nenhum', async () => {
    const { svc, criados, remessas } = servico({ contaCnab: null });
    await expect(svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10', cobrar: 'boleto' }))
      .rejects.toThrow(/CNAB|convênio|Yerevan/i);
    expect(criados).toHaveLength(0);
    expect(remessas).toHaveLength(0);
  });

  it('transferência não precisa de banco: marca a forma e não gera remessa', async () => {
    const { svc, criados, remessas } = servico({ contaCnab: null });
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10', cobrar: 'transferencia' })) as Record<string, unknown>;
    expect(r.forma).toBe('transferencia');
    expect((criados[0] as unknown as { formaCobranca?: string }).formaCobranca).toBe('transferencia');
    expect(remessas).toHaveLength(0);
  });

  it('remessa recusada pelo banco: os títulos FICAM lançados e o aviso volta', async () => {
    const { svc, criados } = servico({ contaCnab: { id: 7, filialId: 2 }, remessaErro: 'Convênio não homologado' });
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10', cobrar: 'boleto' })) as Record<string, unknown>;
    expect(r.titulos).toBe(1);
    expect(criados).toHaveLength(1);
    expect(r.avisoBoleto).toMatch(/não homologado/i);
  });

  it('sem escolher forma: lança o título sem marcar nada (decide depois)', async () => {
    const { svc, criados, remessas } = servico({ contaCnab: { id: 7, filialId: 2 } });
    const r = (await svc.lancarCobranca(123, 1, 'admin', { vencimento: '2026-11-10' })) as Record<string, unknown>;
    expect(r.forma).toBeNull();
    expect((criados[0] as unknown as { formaCobranca?: string }).formaCobranca).toBeUndefined();
    expect(remessas).toHaveLength(0);
  });
});
