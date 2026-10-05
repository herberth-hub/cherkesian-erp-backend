/**
 * Venda para entrega futura: a NF que acompanha a mercadoria NÃO pode lançar
 * conta a receber nem imprimir duplicata — quem cobrou foi a NF de faturamento.
 *
 * Em set/2026 isso custou R$ 71.500,25 de cobrança em dobro (PV38, PV71, PV100,
 * PV101) e R$ 6.139,82 de ICMS destacado duas vezes no PV38.
 */
import { NfeService } from './nfe.service';

type Pedido = { id: number; pedidoPaiId: number | null };
type Nota = { id: number; pedidoId: number; tipo: string; status: string; numero: string; serie: string };

function servicoCom(pedidos: Pedido[], notas: Nota[], devolucoes: Array<{ notaRefId: number }> = []) {
  const prisma = {
    pedido: {
      findMany: ({ where }: { where: { OR: Array<{ id?: number; pedidoPaiId?: number }> } }) => {
        const raiz = where.OR[0].id as number;
        return Promise.resolve(pedidos.filter((p) => p.id === raiz || p.pedidoPaiId === raiz).map((p) => ({ id: p.id })));
      },
    },
    notaFiscal: {
      findMany: ({ where }: { where: Record<string, { in: (number | string)[] } | string> }) => {
        // 2ª consulta: devoluções que anulam as venda-futura encontradas.
        if ('notaRefId' in where) {
          const refs = (where.notaRefId as { in: number[] }).in;
          return Promise.resolve(devolucoes.filter((d) => refs.includes(d.notaRefId)));
        }
        const pedidoIds = (where.pedidoId as { in: number[] }).in;
        const status = (where.status as { in: string[] }).in;
        return Promise.resolve(notas.filter((n) => pedidoIds.includes(n.pedidoId) && n.tipo === where.tipo && status.includes(n.status)));
      },
    },
  };
  // só o helper é exercitado — o resto do serviço não participa deste teste
  return new NfeService(prisma as never, { get: () => undefined } as never, {} as never);
}

const chamar = (s: NfeService, pedidoId?: number | null, paiId?: number | null) =>
  (s as unknown as { faturamentoDeVendaFutura: (a?: number | null, b?: number | null) => Promise<Nota | null> }).faturamentoDeVendaFutura(pedidoId, paiId);

describe('venda futura — trava da cobrança em dobro', () => {
  it('acha o faturamento no próprio pedido (caso PV100/PV101)', async () => {
    const s = servicoCom(
      [{ id: 118, pedidoPaiId: null }],
      [{ id: 108, pedidoId: 118, tipo: 'faturamento', status: 'autorizada', numero: '1/000167', serie: '1' }],
    );
    await expect(chamar(s, 118, null)).resolves.toMatchObject({ numero: '1/000167' });
  });

  it('acha o faturamento do pedido PAI quando a entrega sai pelo filho (caso PV71/PV71-1)', async () => {
    const s = servicoCom(
      [{ id: 89, pedidoPaiId: null }, { id: 140, pedidoPaiId: 89 }],
      [{ id: 106, pedidoId: 89, tipo: 'faturamento', status: 'autorizada', numero: '1/000165', serie: '1' }],
    );
    // a NF de entrega sai pelo pedido-filho 140 — tem que enxergar o faturamento do pai
    await expect(chamar(s, 140, 89)).resolves.toMatchObject({ numero: '1/000165' });
  });

  it('ignora faturamento CANCELADO (caso PV164, NF 2807)', async () => {
    const s = servicoCom(
      [{ id: 200, pedidoPaiId: null }],
      [{ id: 300, pedidoId: 200, tipo: 'faturamento', status: 'cancelada', numero: '1/002807', serie: '1' }],
    );
    await expect(chamar(s, 200, null)).resolves.toBeNull();
  });

  it('venda normal, sem faturamento prévio, continua cobrando', async () => {
    const s = servicoCom(
      [{ id: 10, pedidoPaiId: null }],
      [{ id: 20, pedidoId: 10, tipo: 'venda', status: 'autorizada', numero: '1/000100', serie: '1' }],
    );
    await expect(chamar(s, 10, null)).resolves.toBeNull();
  });

  it('nota avulsa sem pedido não trava nada', async () => {
    const s = servicoCom([], []);
    await expect(chamar(s, null, null)).resolves.toBeNull();
  });

  // Caso PV100/PV101 (out/2026): a venda futura foi DEVOLVIDA e a cobrança teve de
  // ser refeita por nota avulsa. Se a trava ignorasse a devolução, o cliente não
  // seria cobrado de nada.
  it('venda futura DEVOLVIDA não trava mais a cobrança', async () => {
    const s = servicoCom(
      [{ id: 118, pedidoPaiId: null }],
      [{ id: 108, pedidoId: 118, tipo: 'faturamento', status: 'autorizada', numero: '1/000167', serie: '1' }],
      [{ notaRefId: 108 }], // devolvida
    );
    await expect(chamar(s, 118, null)).resolves.toBeNull();
  });

  it('com duas venda-futura, uma devolvida, a que sobrou ainda trava', async () => {
    const s = servicoCom(
      [{ id: 200, pedidoPaiId: null }],
      [
        { id: 300, pedidoId: 200, tipo: 'faturamento', status: 'autorizada', numero: '1/000300', serie: '1' },
        { id: 301, pedidoId: 200, tipo: 'faturamento', status: 'autorizada', numero: '1/000301', serie: '1' },
      ],
      [{ notaRefId: 300 }],
    );
    await expect(chamar(s, 200, null)).resolves.toMatchObject({ numero: '1/000301' });
  });
});
