/**
 * Estorno de expedição e pedido cancelado.
 *
 * 1) Estornar apagava a expedição mas deixava as peças bipadas em "despachado",
 *    apontando para uma expedição que não existe mais: 159 coletes e 6 camisetas
 *    do PV43 ficaram presos assim depois do estorno de 03/11 — estavam na fábrica
 *    e o sistema não deixava bipá-las de novo.
 * 2) Dava para gerar expedição de pedido CANCELADO: a EXP-0194 nasceu no PV04
 *    (duplicata cancelada do PV21), reservou estoque e tirou o pedido de "Cancelado".
 */
import { ConflictException } from '@nestjs/common';
import { ExpedicoesService } from './expedicoes.service';
import { ArquivosService } from '../arquivos/arquivos.service';

type Un = { id: number; expedicaoId: number | null; status: string; pedidoId: number | null; saidaEm: Date | null };

function montar(etapaPedido = 'expedicao') {
  const unidades: Un[] = [
    { id: 1, expedicaoId: 163, status: 'despachado', pedidoId: 60, saidaEm: new Date() },
    { id: 2, expedicaoId: 163, status: 'despachado', pedidoId: null, saidaEm: new Date() },
    { id: 3, expedicaoId: 99, status: 'despachado', pedidoId: 10, saidaEm: new Date() }, // outra expedição: não mexe
  ];
  let apagada = false;
  const casa = (u: Un, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (u as unknown as Record<string, unknown>)[k] === v);
  const tx = {
    pedidoItem: { findUnique: () => Promise.resolve(null), update: () => Promise.resolve({}) },
    unidadeEstoque: {
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<Un> }) => {
        let count = 0;
        for (const u of unidades) if (casa(u, where)) { Object.assign(u, data); count++; }
        return Promise.resolve({ count });
      },
    },
    expedicao: { delete: () => { apagada = true; return Promise.resolve({}); }, count: () => Promise.resolve(0) },
    pedido: { update: () => Promise.resolve({}) },
  };
  const prisma = {
    expedicao: { findUnique: () => Promise.resolve({ id: 163, numero: 'EXP-0163', clienteId: 74, pedidoId: 60, conferenciaStatus: 'conferido', itens: [] }) },
    cliente: { findUnique: () => Promise.resolve({ id: 74, empresaId: 1 }) },
    notaFiscal: { findFirst: () => Promise.resolve(null) },
    pedido: { findUnique: () => Promise.resolve({ id: 16, numero: 'PV04', empresaId: 1, etapa: etapaPedido, itens: [], cliente: {} }) },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const svc = new ExpedicoesService(prisma as never, {} as never, new ArquivosService());
  return { svc, unidades, foiApagada: () => apagada };
}

describe('estorno de expedição devolve as etiquetas', () => {
  it('peças bipadas voltam a RESERVADAS para o pedido, sem vínculo com a expedição apagada', async () => {
    const { svc, unidades, foiApagada } = montar();
    await svc.estornar(163, 1);
    expect(foiApagada()).toBe(true);
    for (const u of unidades.filter((x) => x.id !== 3)) {
      expect(u).toMatchObject({ status: 'reservado', expedicaoId: null, saidaEm: null, pedidoId: 60 });
    }
  });

  it('não mexe em peças de outra expedição', async () => {
    const { svc, unidades } = montar();
    await svc.estornar(163, 1);
    expect(unidades.find((u) => u.id === 3)).toMatchObject({ status: 'despachado', expedicaoId: 99, pedidoId: 10 });
  });
});

describe('pedido cancelado não gera expedição', () => {
  it('recusa a expedição total', async () => {
    const { svc } = montar('cancelado');
    await expect(svc.criarDoPedido(16, 1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa a expedição parcial', async () => {
    const { svc } = montar('cancelado');
    await expect(svc.criarParcial(16, { itens: [] }, 1)).rejects.toBeInstanceOf(ConflictException);
  });
});
