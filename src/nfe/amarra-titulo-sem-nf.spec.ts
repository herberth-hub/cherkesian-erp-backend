/**
 * Despachou SEM NF, lançou a cobrança na expedição, e DEPOIS emite a nota:
 * a NF tem de AMARRAR o título que existe, não criar outro.
 *
 * O filtro tem de ser pedido + nº DESTA expedição. Um filtro só por pedido,
 * ou com o pedidoId indefinido, puxaria título de outra remessa — ou de toda
 * a empresa — e amarraria a nota errada ao título errado.
 */
import { NfeService } from './nfe.service';

type Titulo = { id: number; empresaId: number; pedidoId: number | null; notaFiscalId: number | null; documento: string | null };

const TITULOS: Titulo[] = [
  { id: 1, empresaId: 1, pedidoId: 147, notaFiscalId: null, documento: 'EXP-0123' }, // o do despacho sem NF
  { id: 2, empresaId: 1, pedidoId: 147, notaFiscalId: null, documento: 'EXP-0124' }, // 2ª remessa do MESMO pedido
  { id: 3, empresaId: 1, pedidoId: 125, notaFiscalId: null, documento: 'EXP-0110' }, // outro pedido
  { id: 4, empresaId: 1, pedidoId: 147, notaFiscalId: 99, documento: 'EXP-0123' },   // já amarrado a uma nota
  { id: 5, empresaId: 2, pedidoId: 147, notaFiscalId: null, documento: 'EXP-0123' }, // outra empresa
];

function servico() {
  const prisma = {
    contaReceber: {
      findMany: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          TITULOS.filter(
            (t) =>
              t.empresaId === where.empresaId &&
              t.pedidoId === where.pedidoId &&
              t.notaFiscalId === where.notaFiscalId &&
              t.documento === where.documento,
          ).map((t) => ({ id: t.id })),
        ),
    },
  };
  return { svc: new NfeService(prisma as never, { get: () => undefined } as never, {} as never), prisma };
}

const chamar = (s: NfeService, prisma: unknown, pedidoId: number | null | undefined, numero: string) =>
  (s as unknown as {
    titulosDoDespachoSemNf: (tx: unknown, e: number, p: number | null | undefined, n: string) => Promise<Array<{ id: number }>>;
  }).titulosDoDespachoSemNf(prisma, 1, pedidoId, numero);

describe('NF emitida depois do despacho sem NF amarra o título existente', () => {
  it('acha só o título DESTA expedição', async () => {
    const { svc, prisma } = servico();
    await expect(chamar(svc, prisma, 147, 'EXP-0123')).resolves.toEqual([{ id: 1 }]);
  });

  it('a nota da 2ª remessa não puxa o título da 1ª', async () => {
    const { svc, prisma } = servico();
    await expect(chamar(svc, prisma, 147, 'EXP-0124')).resolves.toEqual([{ id: 2 }]);
  });

  it('expedição sem título lançado: nada a amarrar (a NF cria os títulos normalmente)', async () => {
    const { svc, prisma } = servico();
    await expect(chamar(svc, prisma, 147, 'EXP-0999')).resolves.toEqual([]);
  });

  it('expedição avulsa (sem pedido) NÃO varre a empresa inteira', async () => {
    const { svc, prisma } = servico();
    await expect(chamar(svc, prisma, null, 'EXP-0123')).resolves.toEqual([]);
    await expect(chamar(svc, prisma, undefined, 'EXP-0123')).resolves.toEqual([]);
  });

  it('sem nº de expedição não amarra nada', async () => {
    const { svc, prisma } = servico();
    await expect(chamar(svc, prisma, 147, '')).resolves.toEqual([]);
  });
});
