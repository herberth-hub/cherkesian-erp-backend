/**
 * RELATÓRIO DE ESTOQUE + ESCOLHA DE COLUNAS.
 *
 * Duas coisas são testadas aqui porque nasceram juntas:
 *
 * 1) O estoque REAL mora na UnidadeEstoque (cada etiqueta é uma peça/rolo) — a
 *    tabela `Estoque` está vazia. Um relatório que somasse tudo num número só
 *    mentiria: peça reservada tem dono, comodato está na loja do cliente e
 *    quarentena está bloqueada. Cada situação tem a sua coluna.
 *
 * 2) Quem pede o relatório escolhe o que sai nele. Um PDF de dezesseis colunas
 *    não cabe no papel; o recorte tem de manter a ordem do relatório e avisar,
 *    no próprio papel, que ali está só um pedaço.
 */
import { Prisma } from '@prisma/client';
import { RelatoriosService, recortarColunas, ajustarLarguras } from './relatorios.service';
import { AuthUser } from '../auth/auth.types';

const dec = (n: number) => new Prisma.Decimal(n);
const USER = { acesso: 'total', empresaId: 1, usuario: 'admin' } as unknown as AuthUser;
const PRODUCAO = { acesso: 'producao', empresaId: 1, usuario: 'thais' } as unknown as AuthUser;

/** Uma etiqueta agrupada, como o groupBy do Prisma devolve. */
const g = (over: Record<string, unknown>) => ({
  tipo: 'produto', produtoId: 127, materialId: null, descricao: 'JALECO MÉDICO M.L',
  cor: 'BRANCO', tamanho: 'M', qualidade: 'primeira', status: 'em_estoque',
  _count: { _all: 1 }, _sum: { quantidade: null }, ...over,
});

function servico(grupos: unknown[]) {
  const visto: { where?: Record<string, unknown> } = {};
  const prisma = {
    unidadeEstoque: { groupBy: (args: { where: Record<string, unknown> }) => { visto.where = args.where; return Promise.resolve(grupos); } },
    produto: { findMany: () => Promise.resolve([{ id: 127, codigo: 'PRD-JAL-0014' }]) },
    material: { findMany: () => Promise.resolve([{ id: 55, codigo: 'MP-TEC-0007', unidade: 'm' }]) },
    filial: { findFirst: () => Promise.resolve(null), findMany: () => Promise.resolve([]) },
  };
  return { svc: new RelatoriosService(prisma as never, {} as never), visto };
}

const dados = (svc: RelatoriosService, user = USER, filtros = {}) =>
  (svc as unknown as { dados: (t: string, u: AuthUser, f: unknown) => Promise<{ colunas: Array<{ titulo: string }>; linhas: string[][]; total?: { rotulo: string; valor: string }; descFiltro: string }> })
    .dados('estoque', user, filtros);

describe('o estoque somado por peça', () => {
  it('separa pronta-entrega de reservado, comodato e quarentena', async () => {
    const { svc } = servico([
      g({ _count: { _all: 12 } }),
      g({ status: 'reservado', _count: { _all: 4 } }),
      g({ status: 'comodato', _count: { _all: 3 } }),
      g({ status: 'quarentena', _count: { _all: 1 } }),
    ]);
    const d = await dados(svc);
    expect(d.linhas).toHaveLength(1); // mesma peça, situações diferentes: UMA linha
    const l = d.linhas[0];
    expect(l.slice(0, 5)).toEqual(['PRD-JAL-0014', 'JALECO MÉDICO M.L', 'BRANCO', 'M', '1ª']);
    expect(l.slice(5, 9)).toEqual(['12', '4', '3', '1']);
    expect(l[10]).toBe('20'); // etiquetas = soma de todas as situações
  });

  /**
   * "Pronta-entrega" no resto do sistema (portal, ficha do cliente) é
   * em_estoque + reservado: a peça reservada está na prateleira, só já tem
   * dono. O relatório fala a MESMA língua — e ainda diz quanto está livre,
   * que é a pergunta seguinte.
   */
  it('o total fala a mesma língua do portal: em estoque + reservado', async () => {
    const { svc } = servico([g({ _count: { _all: 12 } }), g({ status: 'reservado', _count: { _all: 40 } })]);
    const d = await dados(svc);
    expect(d.total).toEqual({
      rotulo: 'Pronta-entrega (em estoque + reservado) · 1 item(ns)',
      valor: '52 peça(s) · 12 livre(s)',
    });
  });

  it('comodato e quarentena NÃO entram na pronta-entrega', async () => {
    const { svc } = servico([g({ status: 'comodato', _count: { _all: 9 } }), g({ status: 'quarentena', _count: { _all: 7 } })]);
    const d = await dados(svc);
    expect(d.total!.valor).toBe('0 peça(s) · 0 livre(s)');
  });

  it('situação zerada sai como travessão, não como 0 — o olho procura número', async () => {
    const { svc } = servico([g({ _count: { _all: 12 } })]);
    const d = await dados(svc);
    expect(d.linhas[0].slice(6, 10)).toEqual(['—', '—', '—', '—']);
  });

  it('peça de segunda linha é identificada (continua vendável, mas não como primeira)', async () => {
    const { svc } = servico([g({ qualidade: 'segunda' })]);
    const d = await dados(svc);
    expect(d.linhas[0][4]).toBe('2ª linha');
  });

  it('matéria-prima mostra a METRAGEM, não só a contagem de rolos', async () => {
    const { svc } = servico([
      g({ tipo: 'materia', produtoId: null, materialId: 55, descricao: 'BRIM PROFISSIONAL', tamanho: null, _count: { _all: 3 }, _sum: { quantidade: dec(187.5) } }),
    ]);
    const d = await dados(svc);
    expect(d.linhas[0][0]).toBe('MP-TEC-0007');
    expect(d.linhas[0][3]).toBe('—');          // rolo não tem tamanho
    expect(d.linhas[0][10]).toBe('3');         // três etiquetas…
    expect(d.linhas[0][11]).toBe('187,50 m');  // …mas o que importa é o metro
  });

  it('peça despachada não é estoque — nem é lida do banco', async () => {
    const { svc, visto } = servico([g({})]);
    await dados(svc);
    expect(visto.where!.status).toEqual({ in: ['em_estoque', 'reservado', 'comodato', 'quarentena', 'aguardando_endereco'] });
  });

  it('escolhendo uma situação, o relatório pergunta só por ela', async () => {
    const { svc, visto } = servico([g({})]);
    await dados(svc, USER, { status: 'quarentena' });
    expect(visto.where!.status).toBe('quarentena');
  });
});

describe('quem pode extrair o estoque', () => {
  it('produção, que vive no estoque, consegue', async () => {
    const { svc } = servico([g({})]);
    await expect(dados(svc, PRODUCAO)).resolves.toBeDefined();
  });

  it('perfil sem a área não extrai', async () => {
    const { svc } = servico([g({})]);
    const comercial = { acesso: 'comercial', empresaId: 1 } as unknown as AuthUser;
    await expect(dados(svc, comercial)).rejects.toThrow(/não pode gerar/i);
  });
});

describe('escolher o que sai no relatório', () => {
  const COLS = [
    { titulo: 'Código', largura: 60 },
    { titulo: 'Descrição', largura: 140 },
    { titulo: 'Cor', largura: 50 },
    { titulo: 'Saldo', largura: 50, alinhamento: 'right' as const },
  ];
  const LINHAS = [['PRD-1', 'JALECO', 'BRANCO', '12'], ['PRD-2', 'COLETE', 'VERDE', '40']];

  it('leva só as colunas marcadas, por índice', () => {
    const r = recortarColunas(COLS, LINHAS, '0,3');
    expect(r.colunas.map((c) => c.titulo)).toEqual(['Código', 'Saldo']);
    expect(r.linhas).toEqual([['PRD-1', '12'], ['PRD-2', '40']]);
  });

  it('também entende o nome da coluna, com ou sem acento', () => {
    const r = recortarColunas(COLS, LINHAS, 'descricao, COR');
    expect(r.colunas.map((c) => c.titulo)).toEqual(['Descrição', 'Cor']);
  });

  it('mantém a ordem do relatório, não a ordem em que foram marcadas', () => {
    const r = recortarColunas(COLS, LINHAS, '3,0,1');
    expect(r.colunas.map((c) => c.titulo)).toEqual(['Código', 'Descrição', 'Saldo']);
    expect(r.linhas[0]).toEqual(['PRD-1', 'JALECO', '12']);
  });

  it('seleção vazia ou sem correspondência = relatório inteiro (nunca folha em branco)', () => {
    expect(recortarColunas(COLS, LINHAS, '').colunas).toHaveLength(4);
    expect(recortarColunas(COLS, LINHAS, 'coluna que não existe').colunas).toHaveLength(4);
    expect(recortarColunas(COLS, LINHAS, undefined).colunas).toHaveLength(4);
  });

  it('coluna repetida não duplica a coluna no papel', () => {
    expect(recortarColunas(COLS, LINHAS, '1,1,Descrição').colunas).toHaveLength(1);
  });

  it('o papel avisa que está mostrando um recorte', async () => {
    const { svc } = servico([g({})]);
    const d = await dados(svc, USER, { colunas: '0,1' });
    expect(d.descFiltro).toContain('Colunas: Código, Descrição');
  });

  it('relatório inteiro não anuncia recorte nenhum', async () => {
    const { svc } = servico([g({})]);
    const d = await dados(svc);
    expect(d.descFiltro).not.toContain('Colunas:');
  });
});

describe('a tabela cabe na folha', () => {
  it('relatório largo é espremido para dentro da margem', () => {
    const largas = [{ titulo: 'A', largura: 600 }, { titulo: 'B', largura: 600 }];
    const r = ajustarLarguras(largas, 495);
    expect(r.reduce((s, c) => s + c.largura, 0)).toBeLessThanOrEqual(495);
    expect(r[0].largura).toBe(r[1].largura); // proporção preservada
  });

  it('recorte estreito ocupa a folha inteira em vez de ficar espremido num canto', () => {
    const r = ajustarLarguras([{ titulo: 'A', largura: 40 }, { titulo: 'B', largura: 20 }], 495);
    expect(r.reduce((s, c) => s + c.largura, 0)).toBeGreaterThan(480);
    expect(r[0].largura).toBeGreaterThan(r[1].largura); // o dobro continua o dobro
  });

  it('alinhamento da coluna sobrevive ao ajuste', () => {
    const r = ajustarLarguras([{ titulo: 'Saldo', largura: 50, alinhamento: 'right' }], 495);
    expect(r[0].alinhamento).toBe('right');
  });
});
