/**
 * A OBRIGAÇÃO DA ETIQUETA DE COMPOSIÇÃO, do corte até a trava.
 *
 * A regra que isto protege: nenhuma peça entra no estoque sem ter tido a
 * etiqueta de composição impressa — porque é ela que diz, para o cliente
 * final, de que a peça é feita, que tamanho tem e de que ORDEM DE PRODUÇÃO
 * ela saiu. Sem a OP na etiqueta não há rastreio nenhum depois que a peça
 * sai da fábrica.
 *
 * E a regra que impede a cura de ser pior que a doença: OP cujo corte foi
 * apontado ANTES desta obrigação existir não é travada. Havia 72 em produção
 * no dia em que isto foi escrito; travá-las pararia a fábrica num deploy.
 */
import { OpsService } from './ops.service';

type Linha = { id: number; opId: number; empresaId: number; tamanho: string; devidas: number; impressas: number; impressaEm?: Date | null; impressaPor?: string | null };

const OP_BASE = {
  id: 700, numero: 'OP-0260', empresaId: 1, pedidoId: 90, quantidade: 30,
  gradeTamanhos: { P: 10, M: 20 } as Record<string, number> | null,
  gradeCortada: null as Record<string, number> | null,
  gradeConcluida: null as Record<string, number> | null, quantidadeConcluida: 0,
  gradeFases: null as Record<string, Record<string, number>> | null,
  status: 'em_producao', setorAtual: 'Costura', progresso: 60,
  produtoId: 285, cor: 'AZUL', filialId: 3,
};

function servico(op: Partial<typeof OP_BASE> = {}, etiquetasIniciais: Linha[] = []) {
  const estado = { ...OP_BASE, ...op };
  const etiquetas: Linha[] = etiquetasIniciais.map((e) => ({ ...e }));
  const avisos: Array<Record<string, unknown>> = [];
  let seq = etiquetas.length + 1;

  const prisma = {
    oP: {
      findUnique: () => Promise.resolve(estado),
      update: ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(estado, data);
        return Promise.resolve({ ...estado });
      },
    },
    etiquetaComposicao: {
      findMany: ({ where }: { where: { opId?: number } }) =>
        Promise.resolve(etiquetas.filter((e) => where?.opId == null || e.opId === where.opId)),
      createMany: ({ data }: { data: Array<Omit<Linha, 'id' | 'impressas'>> }) => {
        for (const d of data) etiquetas.push({ ...d, id: seq++, impressas: 0 });
        return Promise.resolve({ count: data.length });
      },
      update: ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const l = etiquetas.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return Promise.resolve(l);
      },
    },
    log: { create: () => Promise.resolve({}) },
  };
  const notificacoes = {
    criar: (_e: number, n: Record<string, unknown>) => { avisos.push(n); return Promise.resolve({}); },
  };
  const svc = new OpsService(prisma as never, notificacoes as never);
  (svc as unknown as { findOne: () => Promise<unknown> }).findOne = () => Promise.resolve(estado);
  return { svc, etiquetas, avisos, estado };
}

describe('o corte cria a obrigação', () => {
  it('apontar corte passa a dever uma etiqueta por peça, tamanho a tamanho', async () => {
    const { svc, etiquetas } = servico();
    await svc.registrarCorte(700, { P: 10, M: 20 }, undefined, 1);
    expect(etiquetas.map((e) => [e.tamanho, e.devidas, e.impressas])).toEqual([['P', 10, 0], ['M', 20, 0]]);
  });

  it('avisa o PCP, com a quantidade por tamanho', async () => {
    const { svc, avisos } = servico();
    await svc.registrarCorte(700, { P: 10, M: 20 }, undefined, 1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].areas).toEqual(['pcp', 'producao']);
    expect(String(avisos[0].titulo)).toContain('OP-0260');
    expect(String(avisos[0].mensagem)).toContain('P: 10');
    expect(String(avisos[0].mensagem)).toContain('M: 20');
  });

  /** O apontamento de corte é cumulativo e TOTAL: reapontar não pode dobrar a dívida. */
  it('reapontar o corte SOBRESCREVE a dívida, não soma', async () => {
    const { svc, etiquetas } = servico();
    await svc.registrarCorte(700, { P: 10, M: 20 }, undefined, 1);
    await svc.registrarCorte(700, { P: 12, M: 20 }, undefined, 1);
    expect(etiquetas.filter((e) => e.tamanho === 'P')).toHaveLength(1);
    expect(etiquetas.find((e) => e.tamanho === 'P')!.devidas).toBe(12);
  });

  it('o que já foi impresso sobrevive a um reapontamento de corte', async () => {
    const { svc, etiquetas } = servico({}, [{ id: 1, opId: 700, empresaId: 1, tamanho: 'P', devidas: 10, impressas: 10 }]);
    await svc.registrarCorte(700, { P: 14, M: 20 }, undefined, 1);
    const p = etiquetas.find((e) => e.tamanho === 'P')!;
    expect(p.devidas).toBe(14);
    expect(p.impressas).toBe(10); // o rastro de quem imprimiu não é apagado
  });

  it('se o aviso falhar, o corte apontado continua valendo', async () => {
    const { svc, etiquetas } = servico();
    (svc as unknown as { notificacoes: unknown }).notificacoes = { criar: () => Promise.reject(new Error('mural fora do ar')) };
    await expect(svc.registrarCorte(700, { P: 10, M: 20 }, undefined, 1)).resolves.toBeTruthy();
    expect(etiquetas).toHaveLength(2);
  });
});

describe('a trava no acabamento', () => {
  const COM_DIVIDA: Linha[] = [
    { id: 1, opId: 700, empresaId: 1, tamanho: 'P', devidas: 10, impressas: 0 },
    { id: 2, opId: 700, empresaId: 1, tamanho: 'M', devidas: 20, impressas: 20 },
  ];

  it('não deixa etiquetar peça cuja etiqueta de composição não foi impressa', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, COM_DIVIDA);
    await expect(svc.concluirParcial(700, { P: 10 }, 1)).rejects.toThrow(/etiqueta\(s\) de composição/i);
  });

  it('o recado diz o número exato que falta', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, COM_DIVIDA);
    await expect(svc.concluirParcial(700, { P: 10 }, 1)).rejects.toThrow(/P: 10/);
  });

  /** O tamanho que JÁ tem etiqueta impressa não pode ficar refém do que não tem. */
  it('deixa concluir o tamanho que já tem etiqueta impressa', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, COM_DIVIDA);
    const r = await svc.concluirParcial(700, { M: 20 }, 1);
    expect(r.totalConcluido).toBe(20);
  });

  it('imprimir libera a conclusão', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, COM_DIVIDA);
    await svc.registrarImpressaoEtiquetas(700, { P: 10 }, 1, 'producao');
    const r = await svc.concluirParcial(700, { P: 10 }, 1);
    expect(r.totalConcluido).toBe(10);
  });

  /**
   * A peça já foi entregue ao cliente. Cobrar etiqueta de algo que não está
   * mais na fábrica não conserta nada e deixaria a OP aberta para sempre.
   */
  it('baixa SEM etiqueta passa mesmo devendo etiqueta de composição', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, COM_DIVIDA);
    const r = await svc.concluirParcial(700, { P: 10 }, 1, { semEtiqueta: true, motivo: 'pecas entregues em 02/11, NF 1502' });
    expect(r.totalConcluido).toBe(10);
  });

  it('OP ANTERIOR à obrigação (sem linha nenhuma) não é travada', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, []);
    const r = await svc.concluirParcial(700, { P: 10, M: 20 }, 1);
    expect(r.totalConcluido).toBe(30);
  });

  it('conclusão parcial repetida continua travando o que ainda não foi impresso', async () => {
    const { svc } = servico({ gradeCortada: { P: 10, M: 20 } }, [
      { id: 1, opId: 700, empresaId: 1, tamanho: 'P', devidas: 10, impressas: 4 },
    ]);
    await expect(svc.concluirParcial(700, { P: 5 }, 1)).rejects.toThrow(/P: 1/);
    const r = await svc.concluirParcial(700, { P: 4 }, 1);
    expect(r.totalConcluido).toBe(4);
  });
});

describe('registrar o que saiu da impressora', () => {
  const LINHAS: Linha[] = [
    { id: 1, opId: 700, empresaId: 1, tamanho: 'P', devidas: 10, impressas: 0 },
    { id: 2, opId: 700, empresaId: 1, tamanho: 'M', devidas: 20, impressas: 0 },
  ];

  it('soma ao que já havia e guarda quem imprimiu', async () => {
    const { svc, etiquetas } = servico({}, LINHAS);
    await svc.registrarImpressaoEtiquetas(700, { P: 6 }, 1, 'producao');
    await svc.registrarImpressaoEtiquetas(700, { P: 4 }, 1, 'producao');
    const p = etiquetas.find((e) => e.tamanho === 'P')!;
    expect(p.impressas).toBe(10);
    expect(p.impressaPor).toBe('producao');
    expect(p.impressaEm).toBeInstanceOf(Date);
  });

  it('devolve o que ainda falta', async () => {
    const { svc } = servico({}, LINHAS);
    const r = await svc.registrarImpressaoEtiquetas(700, { P: 10 }, 1, 'producao');
    expect(r.faltam).toEqual([{ tamanho: 'M', faltam: 20 }]);
    expect(r.totalFaltante).toBe(20);
  });

  /** Etiqueta rasga e é reimpressa; isso não pode virar pendência negativa. */
  it('imprimir a mais não quebra nada', async () => {
    const { svc } = servico({}, LINHAS);
    const r = await svc.registrarImpressaoEtiquetas(700, { P: 13, M: 20 }, 1, 'producao');
    expect(r.totalFaltante).toBe(0);
    expect(r.faltam).toEqual([]);
  });

  it('recusa tamanho que não é do corte', async () => {
    const { svc } = servico({}, LINHAS);
    await expect(svc.registrarImpressaoEtiquetas(700, { GG: 5 }, 1, 'producao')).rejects.toThrow(/não faz parte do corte/i);
  });

  it('recusa quantidade inválida e impressão vazia', async () => {
    const { svc } = servico({}, LINHAS);
    await expect(svc.registrarImpressaoEtiquetas(700, { P: -1 }, 1, 'producao')).rejects.toThrow(/inválida/i);
    await expect(svc.registrarImpressaoEtiquetas(700, { P: 0 }, 1, 'producao')).rejects.toThrow(/ao menos 1/i);
  });

  it('OP sem corte apontado manda apontar o corte primeiro', async () => {
    const { svc } = servico({}, []);
    await expect(svc.registrarImpressaoEtiquetas(700, { P: 1 }, 1, 'producao')).rejects.toThrow(/aponte o corte/i);
  });
});
