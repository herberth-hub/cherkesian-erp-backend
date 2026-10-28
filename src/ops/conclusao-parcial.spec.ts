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
  gradeTamanhos: { G: 16, GG: 10 } as Record<string, number> | null, gradeCortada: null as Record<string, number> | null,
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

  it('corte parcial limita o que ETIQUETA, mas não fecha a OP', async () => {
    // cortou 12 de G (faltou tecido) e 10 de GG, de 16+10 planejados.
    // Este teste afirmava o contrário — que a OP fechava com 22 — e era ele que
    // descrevia o bug da OP-0037, onde os tamanhos não cortados sumiam.
    const { svc } = servico({ gradeCortada: { G: 12, GG: 10 } });
    const r1 = await svc.concluirParcial(516, { G: 12 }, 1);
    expect(r1.finalizada).toBe(false);
    expect(r1.restante).toEqual({ G: 4, GG: 10 });   // contra o PLANEJADO
    expect(r1.aEtiquetar).toEqual({ GG: 10 });        // o que já está cortado
    expect(r1.aCortar).toEqual({ G: 4 });             // falta cortar
    const r2 = await svc.concluirParcial(516, { GG: 10 }, 1);
    expect(r2.finalizada).toBe(false);                // ainda faltam 4 G
    expect(r2.totalAlvo).toBe(26);
    expect(r2.restante).toEqual({ G: 4 });
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

/**
 * OP SEM GRADE DE TAMANHOS — um lote só.
 *
 * Caso real OP-0214 (PV165, 4 peças): o item do pedido não tinha grade, então a
 * OP nasceu sem `gradeTamanhos`. `baseDaConclusao` já representa esse lote com a
 * chave vazia (""), e `gradeFases` gravava {"Separação 1":{"":4}} — mas a
 * validação da conclusão recusava a chave vazia com 'Tamanho inválido: ""'.
 * Resultado: as 4 etiquetas saíam e a OP ficava "em produção" para sempre, sem
 * nunca entrar em Finalizadas.
 */
describe('OP sem grade de tamanhos (lote único)', () => {
  const SEM_GRADE = { quantidade: 4, gradeTamanhos: null, gradeCortada: null };

  it('conclui pela chave vazia e FINALIZA a OP', async () => {
    const { svc } = servico(SEM_GRADE);
    const r = await svc.concluirParcial(516, { '': 4 }, 1);
    expect(r.finalizada).toBe(true);
    expect(r.status).toBe('concluido');
    expect(r.setorAtual).toBe('Finalizado');
    expect(r.progresso).toBe(100);
    expect(r.totalConcluido).toBe(4);
    expect(r.restante).toEqual({});
  });

  it('conclusão parcial do lote único deixa a OP em produção', async () => {
    const { svc, gravado } = servico(SEM_GRADE);
    const r = await svc.concluirParcial(516, { '': 3 }, 1);
    expect(r.finalizada).toBe(false);
    expect(r.restante).toEqual({ '': 1 });
    expect(gravado[0].status).toBeUndefined();
  });

  it('não deixa concluir mais peças do que a OP tem', async () => {
    const { svc } = servico(SEM_GRADE);
    await expect(svc.concluirParcial(516, { '': 5 }, 1)).rejects.toThrow(/faltam 4 peça/i);
  });

  /** A chave vazia só vale onde o lote único existe; numa OP com grade é tamanho faltando. */
  it('OP COM grade continua exigindo o tamanho', async () => {
    const { svc } = servico();
    await expect(svc.concluirParcial(516, { '': 4 }, 1)).rejects.toThrow(/informe o tamanho/i);
  });
});

/**
 * A OP fecha contra o PLANEJADO, nunca contra o cortado.
 *
 * Caso real OP-0037 (PV43): 233 peças planejadas em 5 tamanhos, corte registrado
 * só como {"G":47}. Concluir esses 47 dava a OP por encerrada e 186 peças
 * (M 80, P 53, GG 27, PP 7 e 19 G) sumiam da produção, embora o pedido ainda
 * precisasse delas.
 */
describe('corte parcial NÃO encolhe a ordem', () => {
  const OP_0037 = {
    quantidade: 233,
    gradeTamanhos: { G: 66, M: 80, P: 53, GG: 27, PP: 7 } as Record<string, number> | null,
    gradeCortada: { G: 47 } as Record<string, number> | null,
  };

  it('concluir tudo que foi cortado NÃO finaliza a OP', async () => {
    const { svc } = servico(OP_0037);
    const r = await svc.concluirParcial(516, { G: 47 }, 1);
    expect(r.finalizada).toBe(false);
    expect(r.totalAlvo).toBe(233);
    expect(r.totalConcluido).toBe(47);
  });

  it('o que falta é contra o PLANEJADO, com os tamanhos não cortados juntos', async () => {
    const { svc } = servico(OP_0037);
    const r = await svc.concluirParcial(516, { G: 47 }, 1);
    expect(r.restante).toEqual({ G: 19, M: 80, P: 53, GG: 27, PP: 7 });
    expect(Object.values(r.restante).reduce((s, n) => s + n, 0)).toBe(186);
  });

  it('separa o que dá para ETIQUETAR agora do que ainda falta CORTAR', async () => {
    const { svc } = servico(OP_0037);
    const r = await svc.concluirParcial(516, { G: 40 }, 1);
    expect(r.aEtiquetar).toEqual({ G: 7 });                                   // do que foi cortado
    expect(r.aCortar).toEqual({ G: 19, M: 80, P: 53, GG: 27, PP: 7 });        // nem cortado foi
  });

  it('a OP só fecha quando o concluído alcança o planejado', async () => {
    const { svc } = servico({ ...OP_0037, gradeCortada: { G: 66, M: 80, P: 53, GG: 27, PP: 7 } });
    const r = await svc.concluirParcial(516, { G: 66, M: 80, P: 53, GG: 27, PP: 7 }, 1);
    expect(r.finalizada).toBe(true);
    expect(r.status).toBe('concluido');
  });

  /**
   * REGRA MUDOU (OP-0205): concluir ACIMA do corte apontado passou a ser aceito,
   * e o apontamento sobe junto.
   *
   * O teto era o corte, e a recusa não impedia nada de verdade: a etiqueta nasce
   * em /estoque/entrada, que não consulta corte nenhum. Na prática as peças
   * saíam etiquetadas e a OP ficava aberta para sempre, porque só o registro da
   * conclusão era recusado. O corte apontado é um número que alguém digitou — e
   * quem digitou a menos não deve travar a fábrica. O PLANEJADO continua sendo
   * o limite de verdade.
   */
  it('concluir acima do corte apontado é aceito e acerta o corte', async () => {
    const { svc } = servico(OP_0037);
    const r = await svc.concluirParcial(516, { M: 10 }, 1);
    expect(r.gradeCortada).toEqual({ G: 47, M: 10 });
    expect(r.quantidadeCortada).toBe(57);
    expect(r.finalizada).toBe(false); // longe das 233 planejadas
  });

  it('acima do PLANEJADO continua recusado', async () => {
    const { svc } = servico(OP_0037);
    await expect(svc.concluirParcial(516, { M: 81 }, 1)).rejects.toThrow(/faltam 80 peça/i);
  });
});

/**
 * Re-registrar o corte numa OP que já tem peça etiquetada.
 *
 * Caso OP-0037: a tela do corte listava só os tamanhos JÁ CORTADOS, então quem
 * cortasse o resto não tinha onde informar. Com todos os tamanhos à mostra, o
 * valor digitado é o TOTAL cortado — e não pode ser menor do que já virou
 * etiqueta, porque essa peça existe.
 */
describe('corte cumulativo com peça já etiquetada', () => {
  const COM_ETIQUETA = {
    quantidade: 233,
    gradeTamanhos: { G: 66, M: 80, P: 53, GG: 27, PP: 7 } as Record<string, number> | null,
    gradeCortada: { G: 47 } as Record<string, number> | null,
    gradeConcluida: { G: 47 } as Record<string, number> | null,
    quantidadeConcluida: 47,
  };

  it('aceita somar os tamanhos que faltavam', async () => {
    const { svc } = servico(COM_ETIQUETA);
    const r = (await svc.registrarCorte(516, { G: 66, M: 80, P: 53, GG: 27, PP: 7 }, undefined, 1)) as unknown as
      { quantidadeCortada: number; corteParcial: boolean };
    expect(r.quantidadeCortada).toBe(233);
    expect(r.corteParcial).toBe(false);
  });

  it('recusa corte MENOR do que já foi etiquetado', async () => {
    const { svc } = servico(COM_ETIQUETA);
    await expect(svc.registrarCorte(516, { G: 20, M: 80 }, undefined, 1))
      .rejects.toThrow(/ja ha 47 peça|já há 47 peça/i);
  });

  it('recusa tambem quando o tamanho some do corte', async () => {
    const { svc } = servico(COM_ETIQUETA);
    await expect(svc.registrarCorte(516, { M: 80 }, undefined, 1))
      .rejects.toThrow(/G: /);
  });

  it('OP sem nada etiquetado nao e afetada pela trava', async () => {
    const { svc } = servico({ gradeConcluida: null, quantidadeConcluida: 0 });
    const r = (await svc.registrarCorte(516, { G: 5 }, undefined, 1)) as unknown as { quantidadeCortada: number };
    expect(r.quantidadeCortada).toBe(5);
  });
});
