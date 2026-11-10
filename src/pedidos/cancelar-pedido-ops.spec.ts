/**
 * PEDIDO CANCELADO DERRUBA AS OPs.
 *
 * O cancelamento parava no pedido: a etapa virava "cancelado" e as ordens de
 * produção ficavam vivas. A fábrica seguia com produção contratada de um pedido
 * que não existia mais, e aquelas OPs continuavam contando na fila do PCP e no
 * radar de atraso do painel. O PV139 estava exatamente assim — cancelado, com
 * 5 OPs e 62 peças em pé.
 *
 * O que estes testes seguram: que o cancelamento desce para as OPs, que ele
 * NÃO desfaz o que já foi produzido, e que uma OP cancelada para de contar
 * como ativa em todo lugar (a regra mora num lugar só, de propósito).
 */
import { ConflictException } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { OP_ENCERRADAS, avisoCancelamento, opCancelavel, opViva, whereOpViva } from '../ops/op-status';

type Op = { id: number; numero: string; status: string; quantidade: number; corteObs?: string | null };

function servico(ops: Op[], over: Record<string, unknown> = {}) {
  const pedido = { id: 139, numero: 'PV139', empresaId: 1, etapa: 'producao', status: 'Em produção', ...over };
  const linhas = ops.map((o) => ({ ...o }));
  const logs: Array<Record<string, unknown>> = [];
  const prisma = {
    pedido: {
      findUnique: () => Promise.resolve(pedido),
      update: ({ data }: { data: Record<string, unknown> }) => { Object.assign(pedido, data); return Promise.resolve({ ...pedido }); },
    },
    oP: {
      findMany: () => Promise.resolve(linhas.map((o) => ({ ...o }))),
      updateMany: ({ where, data }: { where: { id: { in: number[] } }; data: Record<string, unknown> }) => {
        const alvo = linhas.filter((o) => where.id.in.includes(o.id));
        for (const o of alvo) Object.assign(o, data);
        return Promise.resolve({ count: alvo.length });
      },
    },
    notaFiscal: { findFirst: () => Promise.resolve((over as { nf?: unknown }).nf ?? null) },
    log: { create: ({ data }: { data: Record<string, unknown> }) => { logs.push(data); return Promise.resolve(data); } },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
  };
  const svc = new PedidosService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, linhas, logs, pedido };
}

// As 5 OPs reais do PV139, do jeito que estavam.
const PV139 = [
  { id: 142, numero: 'OP-0142', status: 'aguardando_material', quantidade: 10 },
  { id: 143, numero: 'OP-0143', status: 'aguardando_material', quantidade: 10 },
  { id: 144, numero: 'OP-0144', status: 'aguardando_material', quantidade: 4 },
  { id: 145, numero: 'OP-0145', status: 'aguardando_material', quantidade: 28 },
  { id: 146, numero: 'OP-0146', status: 'aguardando_material', quantidade: 10 },
];

describe('cancelar o pedido', () => {
  it('cancela as 5 OPs do PV139 junto', async () => {
    const { svc, linhas, pedido } = servico(PV139);
    const r = await svc.cancelar(139, 1, 'herberth');

    expect(pedido.etapa).toBe('cancelado');
    expect(linhas.every((o) => o.status === 'cancelado')).toBe(true);
    expect((r as { opsCanceladas: string[] }).opsCanceladas).toHaveLength(5);
  });

  it('deixa na OP o motivo e o estado de onde ela veio', async () => {
    const { svc, linhas } = servico([{ id: 1, numero: 'OP-1', status: 'em_producao', quantidade: 5 }]);
    await svc.cancelar(139, 1, 'herberth');
    expect(linhas[0].corteObs).toContain('PV139');
    expect(linhas[0].corteObs).toContain('em producao'); // estado do banco, com o "_" trocado por espaço
    expect(linhas[0].corteObs).toContain('Não produzir');
  });

  it('NÃO mexe no que já foi produzido — peça feita é peça feita', async () => {
    const { svc, linhas } = servico([
      { id: 1, numero: 'OP-1', status: 'concluido', quantidade: 20 },
      { id: 2, numero: 'OP-2', status: 'em_corte', quantidade: 5 },
    ]);
    const r = await svc.cancelar(139, 1, 'herberth');
    expect(linhas[0].status).toBe('concluido');
    expect(linhas[1].status).toBe('cancelado');
    expect((r as { opsMantidas: string[] }).opsMantidas).toEqual(['OP-1']);
  });

  it('cancelar duas vezes não cancela nada de novo (idempotente)', async () => {
    const { svc, linhas } = servico(PV139, { etapa: 'cancelado' });
    const r = await svc.cancelar(139, 1, 'herberth');
    expect((r as { jaCancelado?: boolean }).jaCancelado).toBe(true);
    expect(linhas.every((o) => o.status === 'aguardando_material')).toBe(true);
  });

  it('NF ativa continua travando o cancelamento — e aí nenhuma OP é tocada', async () => {
    const { svc, linhas } = servico(PV139, { nf: { numero: '1234' } });
    await expect(svc.cancelar(139, 1, 'herberth')).rejects.toThrow(ConflictException);
    expect(linhas.every((o) => o.status === 'aguardando_material')).toBe(true);
  });

  it('registra no log quais OPs caíram junto', async () => {
    const { svc, logs } = servico(PV139);
    await svc.cancelar(139, 1, 'herberth');
    const log = logs.find((l) => l.acao === 'Pedido cancelado');
    expect(String(log?.detalhe)).toContain('OP-0145 (aguardando_material, 28 pç)');
    expect(log?.usuario).toBe('herberth');
  });

  it('pedido sem OP nenhuma cancela sem reclamar', async () => {
    const { svc, pedido } = servico([]);
    await expect(svc.cancelar(139, 1, 'herberth')).resolves.toBeDefined();
    expect(pedido.etapa).toBe('cancelado');
  });
});

describe('OP cancelada para de contar como ativa', () => {
  it('cancelada e concluída são as duas formas de uma OP terminar', () => {
    expect([...OP_ENCERRADAS].sort()).toEqual(['cancelado', 'concluido']);
    expect(opViva('cancelado')).toBe(false);
    expect(opViva('concluido')).toBe(false);
    expect(opViva('em_producao')).toBe(true);
    expect(opViva('aguardando_material')).toBe(true);
  });

  it('o filtro do banco exclui as duas — senão a OP cancelada apareceria atrasada', () => {
    expect(whereOpViva()).toEqual({ status: { notIn: ['concluido', 'cancelado'] } });
  });

  it('o filtro é um objeto novo a cada chamada (ninguém altera o de todo mundo)', () => {
    const a = whereOpViva();
    a.status.notIn.push('em_producao' as never);
    expect(whereOpViva().status.notIn).toEqual(['concluido', 'cancelado']);
  });

  it('o cancelamento não repete em quem já terminou', () => {
    expect(opCancelavel('concluido')).toBe(false);
    expect(opCancelavel('cancelado')).toBe(false);
    expect(opCancelavel('em_faccao')).toBe(true);
  });

  it('o aviso diz o pedido e o estado anterior, em português legível', () => {
    expect(avisoCancelamento('PV139', 'aguardando_material')).toContain('PV139');
    expect(avisoCancelamento('PV139', 'aguardando_material')).toContain('aguardando material');
  });
});
