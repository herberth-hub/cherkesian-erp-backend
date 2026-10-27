/**
 * PARCELAMENTO de título a receber.
 *
 * O título ORIGINAL vira a parcela 1 em vez de ser apagado e recriado: é nele
 * que estão penduradas a NF, o pedido e a comissão da venda. Apagar e recriar
 * perderia o vínculo — e o cancelamento da NF deixaria parcela órfã viva.
 */
import { Prisma } from '@prisma/client';
import { ContasReceberService } from './contas-receber.service';

const DEC = (n: number) => new Prisma.Decimal(n);
const TITULO = (extra: Record<string, unknown> = {}) => ({
  id: 7, empresaId: 1, filialId: 3, pedidoId: 12, notaFiscalId: 44, clienteId: 9,
  documento: '2635', vencimento: new Date('2026-07-05T12:00:00Z'),
  valor: DEC(4290), pago: DEC(0), juros: DEC(0), formaCobranca: 'boleto',
  ...extra,
});

function servico(titulo: Record<string, unknown> | null, boletos: Array<Record<string, unknown>> = []) {
  const criadas: Array<Record<string, unknown>> = [];
  let atualizado: Record<string, unknown> | null = null;
  const prisma = {
    contaReceber: {
      findUnique: () => Promise.resolve(titulo),
      update: ({ data }: { data: Record<string, unknown> }) => {
        atualizado = { ...titulo, ...data };
        return Promise.resolve(atualizado);
      },
      createMany: ({ data }: { data: Array<Record<string, unknown>> }) => {
        criadas.push(...data);
        return Promise.resolve({ count: data.length });
      },
      findMany: () => Promise.resolve(criadas.map((c, i) => ({ ...c, id: 100 + i, pago: DEC(0), juros: DEC(0) }))),
    },
    boleto: { findMany: () => Promise.resolve(boletos) },
  };
  return { svc: new ContasReceberService(prisma as never), criadas, pego: () => atualizado };
}

const TRES = [
  { vencimento: '2026-07-05', valor: 1430 },
  { vencimento: '2026-08-05', valor: 1430 },
  { vencimento: '2026-09-05', valor: 1430 },
];

describe('parcelar título a receber', () => {
  it('o título original VIRA a parcela 1 — não é apagado', async () => {
    const { svc, criadas, pego } = servico(TITULO());
    const r = await svc.parcelar(7, 1, TRES);
    expect(criadas).toHaveLength(2); // só as parcelas 2 e 3 nascem
    expect(Number(pego()!.valor)).toBe(1430);
    expect(pego()!.documento).toBe('2635 (1/3)');
    expect(r.total).toBe('4290.00');
    expect(r.parcelas).toHaveLength(3);
  });

  it('cada parcela carrega NF, pedido, cliente e forma de cobrança do original', async () => {
    const { svc, criadas } = servico(TITULO());
    await svc.parcelar(7, 1, TRES);
    criadas.forEach((c) => expect(c).toMatchObject({
      empresaId: 1, filialId: 3, pedidoId: 12, notaFiscalId: 44, clienteId: 9, formaCobranca: 'boleto',
    }));
    expect(criadas.map((c) => c.documento)).toEqual(['2635 (2/3)', '2635 (3/3)']);
  });

  it('valor que não divide redondo: a sobra de centavos fica na 1ª', async () => {
    const { svc, pego, criadas } = servico(TITULO({ valor: DEC(100) }));
    const r = await svc.parcelar(7, 1, [
      { vencimento: '2026-07-05', valor: 33.34 },
      { vencimento: '2026-08-05', valor: 33.33 },
      { vencimento: '2026-09-05', valor: 33.33 },
    ]);
    expect(Number(pego()!.valor)).toBe(33.34);
    expect(criadas.map((c) => Number(c.valor))).toEqual([33.33, 33.33]);
    expect(r.total).toBe('100.00');
  });

  /**
   * Parcelar o que já foi recebido em parte muda o que o cliente deve e deixa
   * o valor pago pendurado numa parcela só. Quem decide é o financeiro, não o
   * sistema — então recusa e explica a saída.
   */
  it('RECUSA título que já tem recebimento', async () => {
    const { svc } = servico(TITULO({ pago: DEC(500) }));
    await expect(svc.parcelar(7, 1, TRES)).rejects.toThrow(/já tem R\$ 500,?\.?00 recebido|recebido/i);
  });

  /** O banco já registrou valor e vencimento: dividir aqui faz a cobrança sair diferente do sistema. */
  it('RECUSA quando existe boleto vivo, dizendo qual', async () => {
    const { svc } = servico(TITULO(), [{ nossoNumero: '000123', status: 'registrado' }]);
    await expect(svc.parcelar(7, 1, TRES)).rejects.toThrow(/000123.*registrado/);
  });

  it('boleto já baixado/rejeitado não impede', async () => {
    // o service filtra por status no próprio findMany; aqui ele volta vazio
    const { svc, criadas } = servico(TITULO(), []);
    await svc.parcelar(7, 1, TRES);
    expect(criadas).toHaveLength(2);
  });

  it('recusa menos de 2 e mais de 36 parcelas', async () => {
    const { svc } = servico(TITULO());
    await expect(svc.parcelar(7, 1, [TRES[0]])).rejects.toThrow(/ao menos 2/i);
    const muitas = Array.from({ length: 37 }, () => ({ vencimento: '2026-07-05', valor: 10 }));
    await expect(svc.parcelar(7, 1, muitas)).rejects.toThrow(/36/);
  });

  it('recusa parcela com valor zero ou negativo', async () => {
    const { svc } = servico(TITULO());
    await expect(svc.parcelar(7, 1, [
      { vencimento: '2026-07-05', valor: 4290 },
      { vencimento: '2026-08-05', valor: 0 },
    ])).rejects.toThrow(/maior que zero/i);
  });

  /** "2635 (1/3)" reparcelado não pode virar "2635 (1/3) (1/2)". */
  it('reparcelar não empilha sufixo no documento', async () => {
    const { svc, pego, criadas } = servico(TITULO({ documento: '2635 (1/3)', valor: DEC(1430) }));
    await svc.parcelar(7, 1, [
      { vencimento: '2026-07-05', valor: 715 },
      { vencimento: '2026-08-05', valor: 715 },
    ]);
    expect(pego()!.documento).toBe('2635 (1/2)');
    expect(criadas[0].documento).toBe('2635 (2/2)');
  });

  it('título de outra empresa não é encontrado', async () => {
    const { svc } = servico(TITULO({ empresaId: 99 }));
    await expect(svc.parcelar(7, 1, TRES)).rejects.toThrow(/não encontrado/i);
  });
});
