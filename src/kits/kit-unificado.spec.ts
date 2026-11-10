/**
 * O KIT COMO PACOTE — o serviço, não só a regra.
 *
 * Três coisas não podem quebrar aqui:
 *  1. a OP inteira que vai para uma oficina nasce como UM kit, com a grade;
 *  2. quem já tem kits soltos consegue juntá-los sem perder o rastro — e a
 *     etiqueta já impressa com um código absorvido continua achando o pacote;
 *  3. mandar só parte da OP para uma facção continua funcionando, agora
 *     tirando as peças de dentro da grade.
 */
import { ConflictException } from '@nestjs/common';
import { KitsService } from './kits.service';

type KitRow = Record<string, unknown> & { id: number; codigo: string };

function bancoFake(kitsIniciais: Partial<KitRow>[] = []) {
  const kits: KitRow[] = kitsIniciais.map((k, i) => ({
    id: i + 1, codigo: `KIT-ANTIGO-${i + 1}`, empresaId: 1, opId: 42, pedidoId: 7,
    cor: 'VERDE BANDEIRA', operacaoFaccao: 'Costura', faccaoNome: 'MARIA ISABEL',
    controleFaccao: null, status: 'aguardando_expedicao', grade: null, jogos: 0,
    pecasTotal: 0, caixa: null, unificadoEmId: null, ...k,
  }));
  const eventos: Array<Record<string, unknown>> = [];
  let seq = kits.length;

  const casa = (k: KitRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === 'OR') return (cond as Array<Record<string, unknown>>).some((c) => casa(k, c));
      const v = k[campo];
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        const c = cond as Record<string, unknown>;
        if ('in' in c) return (c.in as unknown[]).includes(v);
        if ('not' in c) return v !== c.not;
      }
      return v === cond;
    });

  const kitApi = {
    findMany: ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { id?: string } }) => {
      const r = kits.filter((k) => casa(k, where ?? {}));
      r.sort((a, b) => (orderBy?.id === 'desc' ? b.id - a.id : a.id - b.id));
      return Promise.resolve(r.map((k) => ({ ...k })));
    },
    findUnique: ({ where }: { where: { id?: number; codigo?: string } }) => {
      const k = kits.find((x) => (where.id != null ? x.id === where.id : x.codigo === where.codigo));
      return Promise.resolve(k ? { ...k } : null);
    },
    count: () => Promise.resolve(kits.length),
    create: ({ data }: { data: Record<string, unknown> }) => {
      const { eventos: ev, ...resto } = data;
      if (ev) eventos.push((ev as { create: Record<string, unknown> }).create);
      const novo = { id: ++seq + 100, ...resto } as KitRow;
      kits.push(novo);
      return Promise.resolve({ ...novo });
    },
    update: ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const k = kits.find((x) => x.id === where.id)!;
      Object.assign(k, data);
      return Promise.resolve({ ...k });
    },
    updateMany: ({ where, data }: { where: { id: { in: number[] } }; data: Record<string, unknown> }) => {
      const alvos = kits.filter((k) => where.id.in.includes(k.id));
      for (const k of alvos) Object.assign(k, data);
      return Promise.resolve({ count: alvos.length });
    },
  };

  const prisma = {
    kit: kitApi,
    kitEvento: { create: ({ data }: { data: Record<string, unknown> }) => { eventos.push(data); return Promise.resolve(data); } },
    oP: {
      findUnique: () => Promise.resolve({
        id: 42, numero: 'OP-0042', empresaId: 1, pedidoId: 7, produtoId: 9, cor: 'VERDE BANDEIRA',
        gradeCortada: { M: 11, G: 6, GG: 3 }, gradeTamanhos: { M: 11, G: 6, GG: 3 },
        pedido: { empresaId: 1, numero: 'PV210', obs: '', cliente: { nome: 'INTS SACA' } },
      }),
    },
    produto: { findUnique: () => Promise.resolve({ descricao: 'COLETE INTS ACI (PAI)' }) },
    loteTecido: { findUnique: () => Promise.resolve(null) },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
  };

  return { prisma, kits, eventos, svc: new KitsService(prisma as never) };
}

describe('gerar os kits da OP', () => {
  it('por padrão nasce UM kit com a grade inteira — é tudo para a mesma oficina', async () => {
    const { svc, kits } = bancoFake();
    const r = await svc.criarDeOp({ opId: 42, faccaoNome: 'MARIA ISABEL' } as never, 1, 'herberth');

    expect(r.total).toBe(1);
    expect(r.unificado).toBe(true);
    expect(kits).toHaveLength(1);
    expect(kits[0].grade).toEqual({ M: 11, G: 6, GG: 3 });
    expect(kits[0].pecasTotal).toBe(20);
    expect(kits[0].jogos).toBe(20);
    expect(kits[0].tamanho).toBe('M·G·GG'); // resumo legível na coluna de tamanho
  });

  it('peças por jogo multiplicam a grade, não só o total', async () => {
    const { svc, kits } = bancoFake();
    await svc.criarDeOp({ opId: 42, pecasPorJogo: 2 } as never, 1, 'herberth');
    expect(kits[0].grade).toEqual({ M: 22, G: 12, GG: 6 });
    expect(kits[0].pecasTotal).toBe(40);
    expect(kits[0].jogos).toBe(20); // jogos continua sendo jogo, não peça
  });

  it('quem precisa de pacote por tamanho ainda consegue — e aí não tem grade', async () => {
    const { svc, kits } = bancoFake();
    const r = await svc.criarDeOp({ opId: 42, separarPorTamanho: true } as never, 1, 'herberth');
    expect(r.total).toBe(3);
    expect(r.unificado).toBe(false);
    expect(kits.map((k) => k.tamanho)).toEqual(['M', 'G', 'GG']);
    expect(kits.every((k) => k.grade === undefined || k.grade === null)).toBe(true);
  });

  it('o evento de criação registra a grade, não só "criado"', async () => {
    const { svc, eventos } = bancoFake();
    await svc.criarDeOp({ opId: 42 } as never, 1, 'herberth');
    expect(String(eventos[0].detalhe)).toContain('M 11 · G 6 · GG 3');
    expect(String(eventos[0].detalhe)).toContain('20 peça');
  });
});

describe('unificar kits que já existem', () => {
  const tres = [
    { id: 1, codigo: 'KIT-A', tamanho: 'M', pecasTotal: 11, jogos: 11, caixa: 'CX-01' },
    { id: 2, codigo: 'KIT-B', tamanho: 'G', pecasTotal: 6, jogos: 6, caixa: 'CX-01' },
    { id: 3, codigo: 'KIT-C', tamanho: 'GG', pecasTotal: 3, jogos: 3, caixa: 'CX-01' },
  ];

  it('três viram um: grade somada, peças somadas, código do mais antigo', async () => {
    const { svc, kits } = bancoFake(tres);
    const r = await svc.unificar({ kitIds: [3, 1, 2] }, 1, 'herberth', '10.0.0.1');

    expect(r.kit.codigo).toBe('KIT-A');
    expect(r.absorvidos).toEqual(['KIT-B', 'KIT-C']);
    expect(kits[0].grade).toEqual({ M: 11, G: 6, GG: 3 });
    expect(kits[0].pecasTotal).toBe(20);
    expect(kits[0].jogos).toBe(20);
  });

  it('os absorvidos não somem — ficam apontando para o sobrevivente', async () => {
    const { svc, kits } = bancoFake(tres);
    await svc.unificar({ kitIds: [1, 2, 3] }, 1, 'herberth');
    expect(kits[1]).toMatchObject({ status: 'unificado', unificadoEmId: 1 });
    expect(kits[2]).toMatchObject({ status: 'unificado', unificadoEmId: 1 });
  });

  it('deixa rastro nos dois lados: no pacote e em cada kit absorvido', async () => {
    const { svc, eventos } = bancoFake(tres);
    await svc.unificar({ kitIds: [1, 2, 3] }, 1, 'herberth');
    const unif = eventos.filter((e) => e.evento === 'unificado');
    expect(unif).toHaveLength(3);
    expect(String(unif[0].detalhe)).toContain('KIT-B, KIT-C');
    expect(String(unif[1].detalhe)).toContain('KIT-A');
  });

  it('caixa só sobrevive se era a mesma em todos — senão viraria mentira', async () => {
    const { svc, kits } = bancoFake(tres);
    await svc.unificar({ kitIds: [1, 2, 3] }, 1, 'herberth');
    expect(kits[0].caixa).toBe('CX-01');

    const misto = bancoFake([{ ...tres[0] }, { ...tres[1], caixa: 'CX-09' }]);
    await misto.svc.unificar({ kitIds: [1, 2] }, 1, 'herberth');
    expect(misto.kits[0].caixa).toBeNull();
  });

  it('recusa juntar kit que já saiu para a oficina', async () => {
    const { svc } = bancoFake([tres[0], { ...tres[1], status: 'em_faccao' }]);
    await expect(svc.unificar({ kitIds: [1, 2] }, 1, 'herberth')).rejects.toThrow(ConflictException);
  });

  it('recusa juntar destinos diferentes', async () => {
    const { svc } = bancoFake([tres[0], { ...tres[1], faccaoNome: 'OUTRA OFICINA' }]);
    await expect(svc.unificar({ kitIds: [1, 2] }, 1, 'herberth')).rejects.toThrow(/Destinos diferentes/i);
  });

  it('id repetido na seleção não vira "unificação" de um kit consigo mesmo', async () => {
    const { svc } = bancoFake(tres);
    await expect(svc.unificar({ kitIds: [1, 1] }, 1, 'herberth')).rejects.toThrow(/pelo menos dois/i);
  });

  it('kit de outra empresa não entra', async () => {
    const { svc } = bancoFake([tres[0], { ...tres[1], empresaId: 2 }]);
    await expect(svc.unificar({ kitIds: [1, 2] }, 1, 'herberth')).rejects.toThrow(/não foram encontrados/i);
  });
});

describe('a tela não mostra o que já acabou', () => {
  const variados = [
    { id: 1, codigo: 'KIT-A', status: 'em_faccao' },
    { id: 2, codigo: 'KIT-B', status: 'finalizado' },
    { id: 3, codigo: 'KIT-C', status: 'retornado' },
    { id: 4, codigo: 'KIT-D', status: 'finalizado' },
  ];

  it('por padrão o kit finalizado fica fora — era mais da metade da lista', async () => {
    const { svc } = bancoFake(variados);
    const r = await svc.listar(1);
    expect(r.map((k) => k.codigo)).toEqual(['KIT-C', 'KIT-A']); // ordem decrescente de id
  });

  it('dá para pedir SÓ os finalizados', async () => {
    const { svc } = bancoFake(variados);
    const r = await svc.listar(1, 'finalizado');
    expect(r.map((k) => k.codigo).sort()).toEqual(['KIT-B', 'KIT-D']);
  });

  it('"todos" traz tudo, inclusive os finalizados', async () => {
    const { svc } = bancoFake(variados);
    expect(await svc.listar(1, 'todos')).toHaveLength(4);
  });

  it('o kit absorvido numa unificação não volta por nenhum filtro', async () => {
    const { svc } = bancoFake([...variados, { id: 5, codigo: 'KIT-E', status: 'unificado', unificadoEmId: 1 }]);
    for (const f of [undefined, 'todos', 'unificado']) {
      const r = await svc.listar(1, f);
      expect(r.find((k) => k.codigo === 'KIT-E')).toBeUndefined();
    }
  });
});

describe('a etiqueta velha continua valendo', () => {
  it('bipar o código de um kit absorvido cai no pacote de verdade', async () => {
    const { svc, prisma } = bancoFake([
      { id: 1, codigo: 'KIT-A', tamanho: 'M', pecasTotal: 11 },
      { id: 2, codigo: 'KIT-B', tamanho: 'G', pecasTotal: 6 },
    ]);
    await svc.unificar({ kitIds: [1, 2] }, 1, 'herberth');

    const achar = (svc as unknown as { acharPorCodigo: (c: string, e: number) => Promise<{ codigo: string }> }).acharPorCodigo.bind(svc);
    await expect(achar('KIT-B', 1)).resolves.toMatchObject({ codigo: 'KIT-A' });
    expect(await prisma.kit.findUnique({ where: { codigo: 'KIT-B' } })).not.toBeNull();
  });
});

describe('a etiqueta Zebra do pacote', () => {
  const zpl = (svc: KitsService, kit: Record<string, unknown>) =>
    (svc as unknown as { montarZpl: (k: unknown) => string }).montarZpl(kit);

  // A etiqueta tem 560 pontos de altura. Texto por cima do código de barras =
  // leitor que não bipa; código de barras abaixo de 560 = código cortado.
  const ultimoTextoY = (z: string) => Math.max(...[...z.matchAll(/\^FO\d+,(\d+)\^FD/g)].map((m) => Number(m[1])));
  const barrasY = (z: string) => Number(/\^FO\d+,(\d+)\^BY2/.exec(z)![1]);
  const cabeNaEtiqueta = (z: string) => {
    expect(ultimoTextoY(z) + 26).toBeLessThanOrEqual(barrasY(z)); // texto não encosta no código
    expect(barrasY(z) + 90 + 30).toBeLessThanOrEqual(560);        // código + legenda cabem
  };

  it('imprime a grade, e não um tamanho que não existe', () => {
    const { svc } = bancoFake();
    const z = zpl(svc, { codigo: 'KIT-A', tamanho: 'M·G·GG', grade: { M: 11, G: 6, GG: 3 }, jogos: 20, pecasTotal: 20 });
    expect(z).toContain('GRADE  (20 PECAS)');
    expect(z).toContain('M:11  G:6  GG:3');
    expect(z).not.toContain('TAMANHO M·G·GG');
  });

  it('kit de um tamanho imprime exatamente como sempre imprimiu', () => {
    const { svc } = bancoFake();
    const z = zpl(svc, { codigo: 'KIT-A', tamanho: 'M', grade: null, jogos: 11, pecasTotal: 11 });
    expect(z).toContain('TAMANHO M  |  11 JOGOS / 11 PECAS');
    expect(z).not.toContain('GRADE');
  });

  it('grade cheia (13 tamanhos) não invade o código de barras', () => {
    const { svc } = bancoFake();
    const grade = { PP: 1, P: 2, M: 3, G: 4, GG: 5, G1: 6, G2: 7, G3: 8, G4: 9, G5: 10, G6: 11, G7: 12, G8: 13 };
    const z = zpl(svc, { codigo: 'KIT-A', tamanho: 'PP·P·M', grade, jogos: 91, pecasTotal: 91 });
    cabeNaEtiqueta(z);
    expect(z).toContain('G8:13'); // e nenhum tamanho ficou de fora
  });

  it('cabe também no caso curto (2 tamanhos) e no de um tamanho só', () => {
    const { svc } = bancoFake();
    cabeNaEtiqueta(zpl(svc, { codigo: 'KIT-A', tamanho: 'M·G', grade: { M: 11, G: 6 }, jogos: 17, pecasTotal: 17 }));
    cabeNaEtiqueta(zpl(svc, { codigo: 'KIT-A', tamanho: 'M', grade: null, jogos: 11, pecasTotal: 11 }));
  });

  it('nenhuma linha da grade avança sobre o QR (que começa em x=560)', () => {
    const { svc } = bancoFake();
    const grade = { PP: 10, P: 20, M: 30, G: 40, GG: 50, G1: 60, G2: 70 };
    const z = zpl(svc, { codigo: 'KIT-A', tamanho: 'PP·P', grade, jogos: 280, pecasTotal: 280 });
    const textos = [...z.matchAll(/\^FO20,\d+\^FD(.*?)\^FS/g)].map((m) => m[1]);
    for (const t of textos) expect(t.length).toBeLessThanOrEqual(38);
  });

  it('o QR leva a grade junto — quem bipa vê o que tem no pacote', () => {
    const { svc } = bancoFake();
    const z = zpl(svc, { codigo: 'KIT-A', tamanho: 'M·G', grade: { M: 11, G: 6 }, jogos: 17, pecasTotal: 17 });
    const qr = /\^FDLA,(\{.*?\})\^FS/s.exec(z);
    expect(qr).not.toBeNull();
    expect(JSON.parse(qr![1]).grade).toEqual({ M: 11, G: 6 });
  });
});

describe('mandar só parte da OP para uma facção', () => {
  const alocar = (svc: KitsService, pool: unknown[], grade: Record<string, number>) =>
    (svc as unknown as { alocarKitsPorGrade: (p: unknown[], g: Record<string, number>) => Promise<Array<Record<string, unknown>>> })
      .alocarKitsPorGrade(pool, grade);

  it('tira as peças de dentro da grade e devolve o resto ao kit original', async () => {
    const { svc, kits } = bancoFake([{ id: 1, codigo: 'KIT-A', tamanho: 'M·G·GG', grade: { M: 11, G: 6, GG: 3 }, pecasTotal: 20 }]);
    const sel = await alocar(svc, [{ ...kits[0] }], { M: 4, GG: 3 });

    expect(sel).toHaveLength(1);
    expect(sel[0].grade).toEqual({ M: 4, GG: 3 });
    expect(sel[0].pecasTotal).toBe(7);
    expect(kits[0].grade).toEqual({ M: 7, G: 6 }); // o que ficou continua disponível
    expect(kits[0].pecasTotal).toBe(13);
  });

  it('pedir a grade inteira leva o kit inteiro, sem criar kit novo', async () => {
    const { svc, kits } = bancoFake([{ id: 1, codigo: 'KIT-A', tamanho: 'M·G', grade: { M: 11, G: 6 }, pecasTotal: 17 }]);
    const sel = await alocar(svc, [{ ...kits[0] }], { M: 11, G: 6 });
    expect(sel.map((k) => k.id)).toEqual([1]);
    expect(kits).toHaveLength(1);
  });

  it('recusa ANTES de partir qualquer kit quando não há peça suficiente', async () => {
    const { svc, kits } = bancoFake([{ id: 1, codigo: 'KIT-A', tamanho: 'M', grade: { M: 11 }, pecasTotal: 11 }]);
    await expect(alocar(svc, [{ ...kits[0] }], { M: 4, GG: 3 })).rejects.toThrow(/GG: pediu 3, há 0/);
    expect(kits).toHaveLength(1); // nada foi partido no meio do caminho
    expect(kits[0].pecasTotal).toBe(11);
  });

  it('junta peças de kits diferentes para fechar a quantidade pedida', async () => {
    const { svc, kits } = bancoFake([
      { id: 1, codigo: 'KIT-A', tamanho: 'M', grade: { M: 5 }, pecasTotal: 5 },
      { id: 2, codigo: 'KIT-B', tamanho: 'M', grade: { M: 9 }, pecasTotal: 9 },
    ]);
    const sel = await alocar(svc, kits.map((k) => ({ ...k })), { M: 8 });
    const pecas = sel.reduce((s, k) => s + Number(k.pecasTotal), 0);
    expect(pecas).toBe(8);
    expect(kits.find((k) => k.id === 2)!.pecasTotal).toBe(6); // sobrou para a próxima OS
  });

  it('kit antigo (sem grade) continua sendo alocado normalmente', async () => {
    const { svc, kits } = bancoFake([{ id: 1, codigo: 'KIT-A', tamanho: 'M', grade: null, pecasTotal: 11 }]);
    const sel = await alocar(svc, [{ ...kits[0] }], { M: 4 });
    expect(sel[0].grade).toEqual({ M: 4 });
    expect(kits[0].pecasTotal).toBe(7);
  });
});
