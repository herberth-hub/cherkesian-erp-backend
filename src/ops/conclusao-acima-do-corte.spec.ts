/**
 * Concluir além do corte APONTADO.
 *
 * Caso real: OP-0205 (PV38), 44 peças planejadas (G 22 · GG 22) e corte lançado
 * como 32. As 32 foram etiquetadas e faturadas; as 12 restantes continuaram na
 * tela, oferecidas para avançar — mas a conclusão era recusada com "G já está
 * concluído nesta OP", porque o teto era o corte apontado. As etiquetas saíam
 * (o estoque não confere corte) e a OP ficava aberta para sempre.
 *
 * O apontamento de corte é um número que alguém digitou; o planejado é o que a
 * ordem vale. Quem conclui a mais está dizendo que cortou a mais e não anotou.
 */
import { OpsService } from './ops.service';

function servico(op: Record<string, unknown>) {
  const estado = { id: 512, numero: 'OP-0205', empresaId: 1, quantidade: 44,
    gradeTamanhos: { G: 22, GG: 22 }, gradeCortada: { G: 16, GG: 16 }, quantidadeCortada: 32,
    corteParcial: true, gradeConcluida: { G: 16, GG: 16 }, quantidadeConcluida: 32,
    gradeFases: null, status: 'em_producao', setorAtual: 'Separação 1', ...op };
  const gravado: Array<Record<string, unknown>> = [];
  const prisma = {
    oP: {
      update: ({ data }: { data: Record<string, unknown> }) => { gravado.push(data); return Promise.resolve({ ...estado, ...data }); },
    },
  };
  const svc = new OpsService(prisma as never, {} as never);
  jest.spyOn(svc, 'findOne').mockResolvedValue(estado as never);
  return { svc, gravado, estado };
}

describe('conclusão acima do corte apontado', () => {
  it('as 12 que faltavam na OP-0205 entram e a OP fecha', async () => {
    const { svc, gravado } = servico({});
    const r = await svc.concluirParcial(512, { G: 6, GG: 6 }, 1) as { finalizada: boolean; totalConcluido: number };
    expect(r.finalizada).toBe(true);
    expect(r.totalConcluido).toBe(44);
    expect(gravado[0]).toMatchObject({
      gradeConcluida: { G: 22, GG: 22 }, quantidadeConcluida: 44,
      status: 'concluido', setorAtual: 'Finalizado', progresso: 100,
    });
  });

  /** O corte apontado sobe junto: senão a OP diria "cortei 32, etiquetei 44". */
  it('o apontamento de corte é acertado para alcançar o concluído', async () => {
    const { svc, gravado } = servico({});
    await svc.concluirParcial(512, { G: 6, GG: 6 }, 1);
    expect(gravado[0]).toMatchObject({ gradeCortada: { G: 22, GG: 22 }, quantidadeCortada: 44, corteParcial: false });
  });

  it('acerto parcial mantém corteParcial ligado', async () => {
    const { svc, gravado } = servico({});
    await svc.concluirParcial(512, { G: 4 }, 1);
    expect(gravado[0]).toMatchObject({ gradeCortada: { G: 20, GG: 16 }, quantidadeCortada: 36, corteParcial: true });
  });

  /** O planejado continua sendo o limite — ninguém etiqueta o que a ordem não pediu. */
  it('passar do PLANEJADO continua recusado, com a conta certa', async () => {
    const { svc, gravado } = servico({});
    await expect(svc.concluirParcial(512, { G: 7 }, 1)).rejects.toThrow(/faltam 6 peça/i);
    expect(gravado).toHaveLength(0);
  });

  it('tamanho realmente esgotado continua recusado', async () => {
    const { svc } = servico({ gradeConcluida: { G: 22, GG: 16 }, quantidadeConcluida: 38 });
    await expect(svc.concluirParcial(512, { G: 1 }, 1)).rejects.toThrow(/já está concluído/i);
  });

  /** Cortar a MAIS que o planejado é permitido; o teto acompanha o corte. */
  it('corte acima do planejado continua valendo como teto', async () => {
    const { svc, gravado } = servico({
      gradeTamanhos: { G: 10 }, quantidade: 10, gradeCortada: { G: 14 }, quantidadeCortada: 14,
      corteParcial: false, gradeConcluida: {}, quantidadeConcluida: 0,
    });
    const r = await svc.concluirParcial(512, { G: 14 }, 1) as { finalizada: boolean };
    expect(r.finalizada).toBe(true);
    expect(gravado[0]).toMatchObject({ gradeConcluida: { G: 14 } });
    expect(gravado[0].gradeCortada).toBeUndefined(); // nada a acertar
  });

  it('OP sem apontamento de corte segue pelo planejado', async () => {
    const { svc, gravado } = servico({ gradeCortada: null, quantidadeCortada: null, corteParcial: false,
      gradeConcluida: {}, quantidadeConcluida: 0 });
    await svc.concluirParcial(512, { G: 22, GG: 22 }, 1);
    expect(gravado[0]).toMatchObject({ quantidadeConcluida: 44, status: 'concluido' });
    expect(gravado[0].gradeCortada).toBeUndefined();
  });
});
