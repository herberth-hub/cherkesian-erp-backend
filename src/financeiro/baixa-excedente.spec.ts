/**
 * Baixa com valor acima do saldo: o excedente vira JUROS, não principal.
 *
 * Quem paga um boleto atrasado tem em mãos o valor TOTAL (o Condomínio de
 * R$ 790,00 pago por R$ 869,33), não a divisão. Antes o sistema recusava e
 * mandava fazer a conta na mão. Agora, com `excedenteComoJuros`, o saldo quita
 * e o resto entra como custo do atraso — que é o que ele é. Sem o flag continua
 * recusando: senão `pago` passaria do valor do título e o custo do atraso
 * sumiria dentro do principal.
 */
import { Prisma } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';
import { ContasReceberService } from './contas-receber.service';

const D = (n: number) => new Prisma.Decimal(n);
// Condomínio Showroom: R$ 790,00, vencido.
const TITULO = { id: 3, empresaId: 1, valor: D(790), pago: D(0), juros: D(0), vencimento: new Date('2026-10-08T12:00:00') };

function pagar(over: Partial<typeof TITULO> = {}) {
  const gravado: { data?: Record<string, Prisma.Decimal | string> } = {};
  const prisma = {
    contaPagar: {
      findUnique: () => Promise.resolve({ ...TITULO, ...over }),
      update: ({ data }: { data: Record<string, Prisma.Decimal | string> }) => {
        gravado.data = data;
        return Promise.resolve({ ...TITULO, ...over, ...data });
      },
    },
  };
  return { svc: new ContasPagarService(prisma as never), gravado };
}

function receber(over: Partial<typeof TITULO> = {}) {
  const gravado: { data?: Record<string, Prisma.Decimal | string> } = {};
  const prisma = {
    contaReceber: {
      findUnique: () => Promise.resolve({ ...TITULO, ...over, clienteId: 9 }),
      update: ({ data }: { data: Record<string, Prisma.Decimal | string> }) => {
        gravado.data = data;
        return Promise.resolve({ ...TITULO, ...over, ...data, clienteId: 9 });
      },
    },
  };
  return { svc: new ContasReceberService(prisma as never), gravado };
}

describe('contas a pagar · excedente vira juros', () => {
  it('sem o flag, recusa e diz de quanto é a diferença', async () => {
    const { svc, gravado } = pagar();
    await expect(svc.baixar(3, 1, 849.54, 'Santander', 19.79))
      .rejects.toThrow(/excede o saldo \(790.00\) em 59.54/);
    expect(gravado.data).toBeUndefined();
  });

  it('com o flag: principal quita o saldo e o resto entra como juros', async () => {
    const { svc, gravado } = pagar();
    // Pagou 849,54 de "principal" + 19,79 de juros num título de 790,00.
    await svc.baixar(3, 1, 849.54, 'Santander', 19.79, true);
    expect((gravado.data!.pago as Prisma.Decimal).toFixed(2)).toBe('790.00');
    // 59,54 que passou do saldo + os 19,79 informados.
    expect((gravado.data!.juros as Prisma.Decimal).toFixed(2)).toBe('79.33');
    expect(gravado.data!.status).toBe('pago');
  });

  it('o banco informado é gravado junto', async () => {
    const { svc, gravado } = pagar();
    await svc.baixar(3, 1, 849.54, 'Santander Yerevan (cobrança)', 0, true);
    expect(gravado.data!.bancoPagto).toBe('Santander Yerevan (cobrança)');
  });

  it('baixa dentro do saldo não é tocada pelo flag', async () => {
    const { svc, gravado } = pagar();
    await svc.baixar(3, 1, 300, 'Santander', 0, true);
    expect((gravado.data!.pago as Prisma.Decimal).toFixed(2)).toBe('300.00');
    expect((gravado.data!.juros as Prisma.Decimal).toFixed(2)).toBe('0.00');
  });

  it('título com baixa parcial: o saldo que vale é o que resta', async () => {
    const { svc, gravado } = pagar({ pago: D(500) });
    // Resta 290,00; pagou 310,00 no boleto.
    await svc.baixar(3, 1, 310, 'Santander', 0, true);
    expect((gravado.data!.pago as Prisma.Decimal).toFixed(2)).toBe('790.00');
    expect((gravado.data!.juros as Prisma.Decimal).toFixed(2)).toBe('20.00');
  });

  it('juros que já existiam no título são somados, não substituídos', async () => {
    const { svc, gravado } = pagar({ juros: D(15) });
    await svc.baixar(3, 1, 800, 'Santander', 0, true);
    expect((gravado.data!.juros as Prisma.Decimal).toFixed(2)).toBe('25.00');
  });

  it('título já quitado continua recusando', async () => {
    const { svc } = pagar({ pago: D(790) });
    await expect(svc.baixar(3, 1, 100, 'X', 0, true)).rejects.toThrow(/já está quitado/i);
  });
});

describe('contas a receber · excedente vira juros', () => {
  it('sem o flag, recusa', async () => {
    const { svc } = receber();
    await expect(svc.baixar(3, 1, 869.33, 0)).rejects.toThrow(/excede o saldo/);
  });

  it('com o flag: recebeu 869,33 de um título de 790,00 -> 79,33 de juros', async () => {
    const { svc, gravado } = receber();
    await svc.baixar(3, 1, 869.33, 0, true);
    expect((gravado.data!.pago as Prisma.Decimal).toFixed(2)).toBe('790.00');
    expect((gravado.data!.juros as Prisma.Decimal).toFixed(2)).toBe('79.33');
  });
});
