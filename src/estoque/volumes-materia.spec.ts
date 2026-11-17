/**
 * UMA ETIQUETA POR VOLUME FÍSICO (rolo/fardo) de matéria-prima.
 *
 * O caso real, de 16/11/2026: uma NF de entrada com rolos distribuídos em
 * quatro lotes — 1, 1, 1 e 2 rolos, cinco volumes ao todo — gerou **quatro**
 * etiquetas. O rolo que fazia par com o quarto ficou sem identificação: não
 * dava para endereçar nem bipar, e na prateleira ninguém sabe que rolo é.
 *
 * A causa era uma linha: `const qtd = granel ? 1 : ...`. Matéria-prima sempre
 * criava UMA unidade, e o número que a tela mandava (o nº de rolos) era gravado
 * como se fosse a METRAGEM — por isso a etiqueta do lote de 200 m saiu escrita
 * "2 Metros".
 *
 * Agora medida e volumes são dois campos:
 *   quantidade = quanto tem (metros/kg)    volumes = em quantos rolos
 */
jest.mock('bwip-js', () => ({ toBuffer: () => Promise.resolve(Buffer.from('bc')) }));

import { EstoqueService } from './estoque.service';

function servico() {
  const lotes: Array<Array<Record<string, unknown>>> = [];
  const saldos: Array<Record<string, unknown>> = [];
  const movs: Array<Record<string, unknown>> = [];
  const prisma = {
    unidadeEstoque: {
      findFirst: () => Promise.resolve(null),
      createMany: ({ data }: { data: Array<Record<string, unknown>> }) => {
        lotes.push(data);
        return Promise.resolve({ count: data.length });
      },
    },
    produto: { findUnique: () => Promise.resolve(null) },
    material: {
      findUnique: () => Promise.resolve({ id: 31, empresaId: 1, codigo: 'MP-TEC-0279', descricao: 'ROVACEL 60% ALGODAO', unidade: 'm', saldo: 0 }),
      update: ({ data }: { data: Record<string, unknown> }) => { saldos.push(data); return Promise.resolve({ id: 31, saldo: 200 }); },
    },
    movimentoMaterial: { create: ({ data }: { data: Record<string, unknown> }) => { movs.push(data); return Promise.resolve(data); } },
  };
  return { svc: new EstoqueService(prisma as never), lotes, saldos, movs };
}

const MP = (quantidade: number, extra: Record<string, unknown> = {}) => ({
  tipo: 'materia', materialId: 31, descricao: 'ROVACEL 60% ALGODAO',
  quantidade, origem: 'entrada', destino: 'estoque', somarSaldo: false, ...extra,
});

/** As linhas que o `createMany` recebeu. */
const linhas = (lotes: Array<Array<Record<string, unknown>>>) => lotes[0] ?? [];

describe('rolos de matéria-prima viram uma etiqueta cada', () => {
  it('O CASO REAL: 2 rolos de um lote geram DUAS etiquetas, não uma', async () => {
    const { svc, lotes } = servico();
    const r = await svc.entrada(MP(200, { volumes: 2 }) as never, 1, 'admin');
    expect(r.total).toBe(2);
    expect(r.pecas).toHaveLength(2);
    expect(linhas(lotes)).toHaveLength(2);
  });

  it('os códigos dos rolos do mesmo lote são DIFERENTES', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(MP(200, { volumes: 2 }) as never, 1, 'admin');
    const cods = linhas(lotes).map((l) => l.codigo);
    expect(new Set(cods).size).toBe(2);
  });

  it('a NF inteira do caso real fecha em 5 etiquetas (1+1+1+2)', async () => {
    const { svc } = servico();
    const partes = [
      await svc.entrada(MP(100, { volumes: 1 }) as never, 1, 'admin'),
      await svc.entrada(MP(200, { volumes: 1 }) as never, 1, 'admin'),
      await svc.entrada(MP(200, { volumes: 1 }) as never, 1, 'admin'),
      await svc.entrada(MP(200, { volumes: 2 }) as never, 1, 'admin'),
    ];
    expect(partes.reduce((s, p) => s + p.pecas.length, 0)).toBe(5);
  });
});

describe('a metragem gravada em cada rolo', () => {
  /** Gravar 200 em cada um dos 2 rolos daria 400 m de estoque que não existem. */
  it('rateia a medida entre os volumes — não repete o total em cada um', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(MP(200, { volumes: 2 }) as never, 1, 'admin');
    const qts = linhas(lotes).map((l) => Number(l.quantidade));
    expect(qts).toEqual([100, 100]);
    expect(qts.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('um rolo só fica com a medida inteira', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(MP(100, { volumes: 1 }) as never, 1, 'admin');
    expect(Number(linhas(lotes)[0].quantidade)).toBe(100);
  });

  it('medida que não divide redondo some certo mesmo assim', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(MP(100, { volumes: 3 }) as never, 1, 'admin');
    const qts = linhas(lotes).map((l) => Number(l.quantidade));
    expect(qts).toHaveLength(3);
    expect(qts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it('a etiqueta mostra a medida DO ROLO, não a do lote', async () => {
    const { svc } = servico();
    const r = await svc.entrada(MP(200, { volumes: 2 }) as never, 1, 'admin');
    expect((r.pecas[0] as { qtdLote?: string }).qtdLote).toBe('100');
    expect((r.pecas[1] as { qtdLote?: string }).qtdLote).toBe('100');
  });
});

describe('o que não pode mudar', () => {
  /** Sem `volumes`, quem já chamava esta rota continua recebendo 1 etiqueta. */
  it('sem informar volumes, continua sendo 1 rolo com a medida inteira', async () => {
    const { svc, lotes } = servico();
    const r = await svc.entrada(MP(57.5) as never, 1, 'admin');
    expect(r.total).toBe(1);
    expect(Number(linhas(lotes)[0].quantidade)).toBe(57.5);
  });

  /** O saldo é do MATERIAL: ele soma a medida da nota, não a de cada rolo. */
  it('o saldo do material soma a medida TOTAL, uma vez só', async () => {
    const { svc, saldos, movs } = servico();
    await svc.entrada(MP(200, { volumes: 2, somarSaldo: true }) as never, 1, 'admin');
    expect(saldos).toHaveLength(1);
    expect(String((saldos[0] as { saldo: { increment: unknown } }).saldo.increment)).toBe('200');
    expect(Number(movs[0].quantidade)).toBe(200);
  });

  it('entrada vinda da NF não mexe no saldo (a nota já somou)', async () => {
    const { svc, saldos } = servico();
    await svc.entrada(MP(200, { volumes: 2 }) as never, 1, 'admin');
    expect(saldos).toHaveLength(0);
  });

  it('produto acabado segue 1 etiqueta por PEÇA, sem volumes', async () => {
    const { svc, lotes } = servico();
    const r = await svc.entrada({ tipo: 'produto', descricao: 'CAMISETA', quantidade: 4, origem: 'producao' } as never, 1, 'admin');
    expect(r.total).toBe(4);
    expect(linhas(lotes)).toHaveLength(4);
  });

  it('recusa um número absurdo de rolos (erro de digitação)', async () => {
    const { svc } = servico();
    await expect(svc.entrada(MP(200, { volumes: 900 }) as never, 1, 'admin')).rejects.toThrow(/500 volumes/i);
  });
});
