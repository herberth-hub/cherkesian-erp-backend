/**
 * SEGUNDA LINHA: peça com defeito leve.
 *
 * Não é quarentena — a peça continua em estoque e pode ser vendida, só não pode
 * sair como primeira sem que se saiba. Por isso é um campo de QUALIDADE, e não um
 * status: a mesma peça pode estar em_estoque, reservada ou despachada sendo de
 * segunda. O defeito é obrigatório: é ele que explica a peça na prateleira e no
 * portal do cliente.
 */
import { EstoqueService } from './estoque.service';

type Un = { id: number; codigo: string; status: string; qualidade: string; descricao: string; cor: string | null; tamanho: string | null };

const BASE: Un[] = [
  { id: 1, codigo: 'UN-20261015-000001', status: 'em_estoque', qualidade: 'primeira', descricao: 'CAMISETA', cor: 'BEGE', tamanho: 'M' },
  { id: 2, codigo: 'UN-20261015-000002', status: 'em_estoque', qualidade: 'primeira', descricao: 'CAMISETA', cor: 'BEGE', tamanho: 'G' },
  { id: 3, codigo: 'UN-20261015-000003', status: 'reservado', qualidade: 'primeira', descricao: 'CAMISETA', cor: 'BEGE', tamanho: 'G' },
  { id: 4, codigo: 'UN-20261015-000004', status: 'despachado', qualidade: 'primeira', descricao: 'CAMISETA', cor: 'BEGE', tamanho: 'P' },
  { id: 5, codigo: 'UN-20261015-000005', status: 'em_estoque', qualidade: 'segunda', descricao: 'CAMISETA', cor: 'BEGE', tamanho: 'M' },
];

function servico(uns: Un[] = BASE) {
  const updates: Array<{ ids: number[]; data: Record<string, unknown> }> = [];
  const prisma = {
    unidadeEstoque: {
      findMany: ({ where }: { where: { codigo: { in: string[] } } }) =>
        Promise.resolve(uns.filter((u) => where.codigo.in.includes(u.codigo))),
      updateMany: ({ where, data }: { where: { id: { in: number[] } }; data: Record<string, unknown> }) => {
        updates.push({ ids: where.id.in, data });
        return Promise.resolve({ count: where.id.in.length });
      },
    },
    log: { create: () => Promise.resolve({}) },
  };
  return { svc: new EstoqueService(prisma as never), updates };
}

const cod = (n: number) => `UN-20261015-${String(n).padStart(6, '0')}`;

describe('classificar peças como segunda linha', () => {
  it('marca as peças e grava o defeito, quem classificou e quando', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade(
      { codigos: [cod(1), cod(2)], qualidade: 'segunda', defeito: 'Mancha leve' },
      1, 'admin',
    );
    expect(r.alteradas).toBe(2);
    expect(r.codigos).toEqual([cod(1), cod(2)]);
    expect(updates).toHaveLength(1);
    expect(updates[0].ids).toEqual([1, 2]);
    expect(updates[0].data).toMatchObject({ qualidade: 'segunda', defeito: 'Mancha leve', qualidadePor: 'admin' });
    expect(updates[0].data.qualidadeEm).toBeInstanceOf(Date);
  });

  it('sem defeito não marca — é o defeito que justifica a segunda linha', async () => {
    const { svc, updates } = servico();
    await expect(svc.classificarQualidade({ codigos: [cod(1)], qualidade: 'segunda' }, 1, 'admin'))
      .rejects.toThrow(/defeito/i);
    await expect(svc.classificarQualidade({ codigos: [cod(1)], qualidade: 'segunda', defeito: '   ' }, 1, 'admin'))
      .rejects.toThrow(/defeito/i);
    expect(updates).toHaveLength(0);
  });

  it('peça RESERVADA pode ser marcada — ela ainda está aqui', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade({ codigos: [cod(3)], qualidade: 'segunda', defeito: 'Falha de costura' }, 1, 'admin');
    expect(r.alteradas).toBe(1);
    expect(updates[0].ids).toEqual([3]);
  });

  it('peça JÁ DESPACHADA não é alterada — não está mais aqui para reavaliar', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade({ codigos: [cod(4)], qualidade: 'segunda', defeito: 'Mancha leve' }, 1, 'admin');
    expect(r.alteradas).toBe(0);
    expect(r.despachadas).toEqual([cod(4)]);
    expect(updates).toHaveLength(0);
  });

  it('peça que já era de segunda não é remarcada, e o relatório diz isso', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade({ codigos: [cod(5)], qualidade: 'segunda', defeito: 'Mancha leve' }, 1, 'admin');
    expect(r.alteradas).toBe(0);
    expect(r.jaEstavam).toEqual([cod(5)]);
    expect(updates).toHaveLength(0);
  });

  it('código inexistente é reportado, sem derrubar o resto do lote', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade(
      { codigos: [cod(1), 'UN-20261015-999999'], qualidade: 'segunda', defeito: 'Mancha leve' },
      1, 'admin',
    );
    expect(r.alteradas).toBe(1);
    expect(r.naoEncontradas).toEqual(['UN-20261015-999999']);
    expect(r.mensagem).toMatch(/1 não encontrada/);
  });

  it('voltar para PRIMEIRA limpa o defeito e não exige motivo', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade({ codigos: [cod(5)], qualidade: 'primeira' }, 1, 'admin');
    expect(r.alteradas).toBe(1);
    expect(updates[0].data).toMatchObject({ qualidade: 'primeira', defeito: null });
  });

  it('código repetido na bipagem conta uma vez só', async () => {
    const { svc, updates } = servico();
    const r = await svc.classificarQualidade(
      { codigos: [cod(1), cod(1), ' ' + cod(1) + ' '], qualidade: 'segunda', defeito: 'Mancha leve' },
      1, 'admin',
    );
    expect(r.alteradas).toBe(1);
    expect(updates[0].ids).toEqual([1]);
  });

  it('lista vazia e lote acima de 500 são recusados', async () => {
    const { svc } = servico();
    await expect(svc.classificarQualidade({ codigos: [], qualidade: 'segunda', defeito: 'x' }, 1, 'admin'))
      .rejects.toThrow(/Bipe ao menos uma/i);
    const muitos = Array.from({ length: 501 }, (_, i) => cod(10_000 + i));
    await expect(svc.classificarQualidade({ codigos: muitos, qualidade: 'segunda', defeito: 'x' }, 1, 'admin'))
      .rejects.toThrow(/500/);
  });

  it('a lista de defeitos sugeridos inclui "Outro" para o caso não previsto', () => {
    const { svc } = servico();
    const d = svc.defeitos();
    expect(d).toContain('Mancha leve');
    expect(d[d.length - 1]).toBe('Outro');
  });
});
