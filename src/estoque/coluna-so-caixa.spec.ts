/**
 * COLUNA C — o pilar da loja. Uma estante SEM ANDAR: o que está escrito lá são
 * as caixas, e é a caixa que localiza a peça.
 *
 * Duas coisas precisam ficar presas aqui, e as duas por motivo de chão de
 * fábrica, não de código:
 *
 *  1. Andar não pode ser exigido. Não existe andar escrito no pilar — cobrar um
 *     faria o operador inventar um número, e número inventado some peça.
 *  2. Caixa não pode ser opcional. Sem ela a peça fica com "coluna C" e mais
 *     nada, o que é a mesma coisa que não ter endereço numa estante inteira.
 */
import { EstoqueService } from './estoque.service';

const UN = (codigo: string, status: string, extra: Record<string, unknown> = {}) => ({
  codigo, status, empresaId: 1, descricao: 'CAMISETA GOLA CARECA MC', cor: 'VERDE BANDEIRA', tamanho: 'G',
  produtoId: 5, expedicaoId: null, pedidoId: null, qualidade: 'primeira',
  coluna: null, andar: null, caixaMaster: null, comodatoClienteId: null, comodatoEm: null,
  ...extra,
});

function servico(unidades: Array<ReturnType<typeof UN>>) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const prisma = {
    unidadeEstoque: {
      findMany: ({ where }: { where: { codigo?: { in: string[] } } }) =>
        Promise.resolve(unidades.filter((u) => !where.codigo || where.codigo.in.includes(u.codigo))),
      findUnique: ({ where }: { where: { codigo: string } }) =>
        Promise.resolve(unidades.find((u) => u.codigo === where.codigo) ?? null),
      update: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(a);
        return Promise.resolve({ ...unidades[0], ...a.data });
      },
      updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(a);
        return Promise.resolve({ count: ((a.where.codigo as { in: string[] })?.in ?? []).length });
      },
    },
    cliente: { findUnique: () => Promise.resolve(null) },
    log: { create: () => Promise.resolve({}) },
  };
  return { svc: new EstoqueService(prisma as never), updates };
}

describe('coluna C — o pilar (só caixas)', () => {
  it('endereça sem andar: coluna + caixa basta', async () => {
    const { svc, updates } = servico([UN('UN-1', 'aguardando_endereco')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'C', caixaMaster: '6.000' }, 1, 'herberth');
    expect(r.enderecadas).toBe(1);
    expect(r.endereco).toBe('Coluna C · Caixa 6.000');
    expect(updates[0].data).toMatchObject({ coluna: 'C', andar: null, caixaMaster: '6.000' });
  });

  it('andar digitado por engano no pilar é descartado, não gravado', async () => {
    const { svc, updates } = servico([UN('UN-1', 'em_estoque')]);
    await svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'C', andar: '2', caixaMaster: '6.000' }, 1, 'h');
    expect(updates[0].data.andar).toBeNull();
  });

  it('sem caixa a peça não entra no pilar — não haveria como achá-la', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque')]);
    await expect(svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'C' }, 1, 'h')).rejects.toThrow(/caixa master/i);
  });

  it('nas colunas com andar nada muda: A continua exigindo andar', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque')]);
    await expect(svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'A', caixaMaster: '1.000' }, 1, 'h')).rejects.toThrow(/andar/i);
  });

  it('bipagem de uma peça só segue a mesma regra', async () => {
    const { svc, updates } = servico([UN('UN-1', 'aguardando_endereco')]);
    const r = await svc.enderecar({ codigo: 'UN-1', coluna: 'C', caixaMaster: '6.000' }, 1, 'herberth');
    expect(r.endereco).toBe('Coluna C · Caixa 6.000');
    expect(updates[0].data).toMatchObject({ coluna: 'C', andar: null, caixaMaster: '6.000', status: 'em_estoque' });
  });

  it('bipagem no pilar sem caixa é recusada', async () => {
    const { svc } = servico([UN('UN-1', 'aguardando_endereco')]);
    await expect(svc.enderecar({ codigo: 'UN-1', coluna: 'C' }, 1, 'h')).rejects.toThrow(/caixa master/i);
  });

  /**
   * Trocar a peça de caixa DENTRO do mesmo pilar é uma mudança de lugar como
   * qualquer outra: tem de pedir confirmação, senão a peça muda de endereço sem
   * ninguém ver.
   */
  it('trocar de caixa dentro do pilar pede confirmação', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque', { coluna: 'C', caixaMaster: '6.000' })]);
    const r = await svc.enderecar({ codigo: 'UN-1', coluna: 'C', caixaMaster: '7.000' }, 1, 'h') as { precisaConfirmar?: boolean; atual?: string; novo?: string };
    expect(r.precisaConfirmar).toBe(true);
    expect(r.atual).toBe('Coluna C · Caixa 6.000');
    expect(r.novo).toBe('Coluna C · Caixa 7.000');
  });

  it('bipar de novo na MESMA caixa não vira movimentação', async () => {
    const { svc, updates } = servico([UN('UN-1', 'em_estoque', { coluna: 'C', caixaMaster: '6.000' })]);
    const r = await svc.enderecar({ codigo: 'UN-1', coluna: 'C', caixaMaster: '6.000' }, 1, 'h') as { jaAqui?: boolean };
    expect(r.jaAqui).toBe(true);
    expect(updates).toHaveLength(0);
  });
});

describe('entrada direto no pilar', () => {
  function servicoEntrada() {
    const lotes: Array<Array<Record<string, unknown>>> = [];
    const prisma = {
      unidadeEstoque: {
        findFirst: () => Promise.resolve(null),
        createMany: ({ data }: { data: Array<Record<string, unknown>> }) => { lotes.push(data); return Promise.resolve({ count: data.length }); },
      },
      produto: { findUnique: () => Promise.resolve({ id: 5, empresaId: 1, codigo: 'PRD-CAM-0220', descricao: 'CAMISETA', codigosPorTamanho: null }) },
      material: { findUnique: () => Promise.resolve(null) },
    };
    return { svc: new EstoqueService(prisma as never), lotes };
  }

  const ENTRADA = (extra: Record<string, unknown>) => ({
    tipo: 'produto', produtoId: 5, descricao: 'CAMISETA', cor: 'VERDE BANDEIRA', tamanho: 'G',
    quantidade: 3, origem: 'entrada', destino: 'estoque', ...extra,
  });

  it('coluna C + caixa já nasce EM ESTOQUE, sem andar', async () => {
    const { svc, lotes } = servicoEntrada();
    const r = await svc.entrada(ENTRADA({ coluna: 'C', caixaMaster: '6.000' }) as never, 1, 'herberth');
    expect(r.status).toBe('em_estoque');
    expect(r.endereco).toBe('Coluna C · Caixa 6.000');
    lotes[0].forEach((l) => expect(l).toMatchObject({ coluna: 'C', andar: null, caixaMaster: '6.000', status: 'em_estoque' }));
  });

  it('coluna C sem caixa fica aguardando endereço (vai ser bipada depois)', async () => {
    const { svc, lotes } = servicoEntrada();
    const r = await svc.entrada(ENTRADA({ coluna: 'C' }) as never, 1, 'h');
    expect(r.status).toBe('aguardando_endereco');
    expect(lotes[0][0].andar).toBeNull();
  });
});
