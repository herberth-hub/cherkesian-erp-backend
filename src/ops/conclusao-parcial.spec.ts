/**
 * Conclusão PARCIAL da OP e corte com peça a mais.
 *
 * Antes a OP era tudo ou nada: concluir etiquetava a grade inteira e fechava a
 * ordem. Quem terminava só um tamanho tinha de esperar o resto ficar pronto para
 * poder etiquetar e expedir qualquer coisa.
 *
 * E o corte não aceitava passar do planejado. Tecido tubular rende peça a mais no
 * encaixe; como o sistema barrava, a peça existia no chão de fábrica e não existia
 * no sistema. Agora entra, e o excedente vira estoque livre em vez de reserva do
 * pedido — porque não foi o pedido que pediu aquelas peças.
 */
import { OpsService } from './ops.service';

const OP_BASE = {
  id: 516, numero: 'OP-0209', empresaId: 1, pedidoId: 55, quantidade: 26,
  gradeTamanhos: { G: 16, GG: 10 }, gradeCortada: null as Record<string, number> | null,
  gradeConcluida: null as Record<string, number> | null, quantidadeConcluida: 0,
  status: 'em_producao', setorAtual: 'Costura', progresso: 75,
};

function servico(op: Partial<typeof OP_BASE> = {}) {
  const estado = { ...OP_BASE, ...op };
  const gravado: Array<Record<string, unknown>> = [];
  const prisma = {
    oP: {
      findUnique: () => Promise.resolve(estado),
      update: ({ data }: { data: Record<string, unknown> }) => {
        gravado.push(data);
        Object.assign(estado, data);
        return Promise.resolve({ ...estado });
      },
    },
  };
  const svc = new OpsService(prisma as never, {} as never);
  (svc as unknown as { findOne: () => Promise<unknown> }).findOne = () => Promise.resolve(estado);
  return { svc, gravado, estado };
}

describe('conclusão parcial da OP', () => {
  it('conclui só um tamanho: a OP NÃO é finalizada e continua na fase atual', async () => {
    const { svc, gravado } = servico();
    const r = await svc.concluirParcial(516, { G: 16 }, 1);
    expect(r.finalizada).toBe(false);
    expect(r.restante).toEqual({ GG: 10 });
    // nada de status/setor/progresso no update — a OP fica onde estava
    expect(gravado[0].status).toBeUndefined();
    expect(gravado[0].setorAtual).toBeUndefined();
    expect(gravado[0].progresso).toBeUndefined();
    expect(gravado[0].gradeConcluida).toEqual({ G: 16 });
  });

  it('acumula entre rodadas e fecha a OP quando completa', async () => {
    const { svc } = servico({ gradeConcluida: { G: 16 }, quantidadeConcluida: 16 });
    const r = await svc.concluirParcial(516, { GG: 10 }, 1);
    expect(r.totalConcluido).toBe(26);
    expect(r.finalizada).toBe(true);
    expect(r.restante).toEqual({});
    expect(r.status).toBe('concluido');
    expect(r.setorAtual).toBe('Finalizado');
    expect(r.progresso).toBe(100);
  });

  it('não deixa concluir mais do que falta', async () => {
    const { svc } = servico({ gradeConcluida: { G: 14 }, quantidadeConcluida: 14 });
    await expect(svc.concluirParcial(516, { G: 5 }, 1)).rejects.toThrow(/faltam 2 peça/i);
  });

  it('não deixa concluir tamanho já fechado', async () => {
    const { svc } = servico({ gradeConcluida: { G: 16 }, quantidadeConcluida: 16 });
    await expect(svc.concluirParcial(516, { G: 1 }, 1)).rejects.toThrow(/já está concluído/i);
  });

  it('exige ao menos 1 peça', async () => {
    const { svc } = servico();
    await expect(svc.concluirParcial(516, { G: 0 }, 1)).rejects.toThrow(/ao menos 1 peça/i);
  });

  it('corte parcial manda: a base é o CORTADO, não o planejado', async () => {
    // cortou 12 de G (faltou tecido) e 10 de GG -> a OP fecha com 22, não 26
    const { svc } = servico({ gradeCortada: { G: 12, GG: 10 } });
    const r1 = await svc.concluirParcial(516, { G: 12 }, 1);
    expect(r1.finalizada).toBe(false);
    expect(r1.restante).toEqual({ GG: 10 });
    const r2 = await svc.concluirParcial(516, { GG: 10 }, 1);
    expect(r2.finalizada).toBe(true);
    expect(r2.totalBase).toBe(22);
  });

  it('corte com peça A MAIS entra na conclusão (tecido tubular)', async () => {
    const { svc } = servico({ gradeCortada: { G: 18, GG: 10 } }); // 2 a mais em G
    const r = await svc.concluirParcial(516, { G: 18, GG: 10 }, 1);
    expect(r.totalBase).toBe(28);
    expect(r.totalConcluido).toBe(28);
    expect(r.finalizada).toBe(true);
  });
});

describe('registro do corte', () => {
  it('aceita cortar MAIS que o planejado e devolve o excedente por tamanho', async () => {
    const { svc } = servico();
    const r = (await svc.registrarCorte(516, { G: 18, GG: 10 }, 'tecido tubular rendeu', 1)) as unknown as
      { excedente: Record<string, number>; totalExcedente: number; corteParcial: boolean; quantidadeCortada: number };
    expect(r.excedente).toEqual({ G: 2 });
    expect(r.totalExcedente).toBe(2);
    expect(r.quantidadeCortada).toBe(28);
    expect(r.corteParcial).toBe(false);
  });

  it('a mais num tamanho e a menos noutro: conta os dois', async () => {
    const { svc } = servico();
    const r = (await svc.registrarCorte(516, { G: 18, GG: 6 }, undefined, 1)) as unknown as
      { excedente: Record<string, number>; totalExcedente: number; corteParcial: boolean };
    expect(r.excedente).toEqual({ G: 2 });   // GG faltou, não vira excedente
    expect(r.corteParcial).toBe(true);        // 24 < 26 no total
  });

  it('corte parcial continua funcionando', async () => {
    const { svc } = servico();
    const r = (await svc.registrarCorte(516, { G: 10 }, 'acabou o tecido', 1)) as unknown as
      { corteParcial: boolean; totalExcedente: number; setorAtual: string };
    expect(r.corteParcial).toBe(true);
    expect(r.totalExcedente).toBe(0);
    expect(r.setorAtual).toMatch(/corte parcial/);
  });

  it('barra erro de digitação (260 no lugar de 26)', async () => {
    const { svc } = servico();
    await expect(svc.registrarCorte(516, { G: 260 }, undefined, 1)).rejects.toThrow(/muito acima do planejado/i);
  });
});
