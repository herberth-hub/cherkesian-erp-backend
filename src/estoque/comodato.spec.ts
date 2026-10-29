/**
 * COMODATO — peça nossa guardada na LOJA DO CLIENTE, que vende e paga sob venda.
 *
 * O risco todo está em confundir isso com estoque na prateleira: a peça existe,
 * é nossa, mas não está aqui. Se contasse como pronta-entrega, a separação
 * prometeria peça que está na loja de outro — exatamente o tipo de estoque
 * fantasma que já custou caro. Estes testes prendem esse limite.
 */
import { EstoqueService } from './estoque.service';

const UN = (codigo: string, status: string, extra: Record<string, unknown> = {}) => ({
  codigo, status, empresaId: 1, descricao: 'CALCA PROFISSIONAL', cor: 'AZUL ROYAL', tamanho: 'M',
  produtoId: 5, expedicaoId: null, pedidoId: null, qualidade: 'primeira',
  coluna: null, andar: null, caixaMaster: null, comodatoClienteId: null, comodatoEm: null,
  ...extra,
});

const CLIENTE = { id: 7, nome: 'INTS BICAS COMERCIO LTDA', fantasia: 'INTS BICAS' };

function servico(unidades: Array<ReturnType<typeof UN>>, clientes = [CLIENTE]) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const prisma = {
    unidadeEstoque: {
      findMany: ({ where }: { where: { codigo?: { in: string[] }; status?: unknown } }) =>
        Promise.resolve(
          unidades
            .filter((u) => !where.codigo || where.codigo.in.includes(u.codigo))
            .filter((u) => (typeof where.status === 'string' ? u.status === where.status : true)),
        ),
      updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(a);
        return Promise.resolve({ count: ((a.where.codigo as { in: string[] })?.in ?? []).length });
      },
    },
    cliente: {
      findUnique: ({ where }: { where: { id: number } }) => Promise.resolve(clientes.find((c) => c.id === where.id) ?? null),
      findMany: ({ where }: { where: { id: { in: number[] } } }) => Promise.resolve(clientes.filter((c) => where.id.in.includes(c.id))),
      count: ({ where }: { where: { id: number } }) => Promise.resolve(clientes.some((c) => c.id === where.id) ? 1 : 0),
    },
    produto: { findMany: () => Promise.resolve([{ id: 5, codigo: 'PRD-CAL-0005' }]) },
    material: { findMany: () => Promise.resolve([]) },
    expedicao: { findMany: () => Promise.resolve([]) },
    pedido: { findMany: () => Promise.resolve([]) },
    log: { create: () => Promise.resolve({}) },
  };
  return { svc: new EstoqueService(prisma as never), updates };
}

describe('mandar peças em comodato', () => {
  it('manda o lote para a loja do cliente, sem andar nem caixa', async () => {
    const { svc, updates } = servico([UN('UN-1', 'em_estoque'), UN('UN-2', 'aguardando_endereco')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1', 'UN-2'], coluna: 'C', comodatoClienteId: 7 }, 1, 'herberth');
    expect(r.enderecadas).toBe(2);
    expect(r.comodato).toBe(true);
    expect(r.comodatoCliente).toBe('INTS BICAS');
    expect(updates[0].data).toMatchObject({ coluna: 'C', andar: null, caixaMaster: null, status: 'comodato', comodatoClienteId: 7 });
    // Nenhuma escrita extra mandando para 'em_estoque' — a peça não está aqui.
    expect(updates.some((u) => u.data.status === 'em_estoque')).toBe(false);
  });

  it('recusa peça RESERVADA para expedição', async () => {
    const { svc } = servico([UN('UN-1', 'reservado'), UN('UN-2', 'em_estoque')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1', 'UN-2'], coluna: 'C', comodatoClienteId: 7 }, 1, 'h');
    expect(r.enderecadas).toBe(1);
    expect(r.ignoradas.reservadasBloqueadas).toEqual(['UN-1']);
  });

  it('não deixa mandar sem dizer para qual cliente', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque')]);
    await expect(svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'C' }, 1, 'h')).rejects.toThrow(/cliente/i);
  });

  it('voltando ao armazém, o vínculo com a loja sai junto', async () => {
    const { svc, updates } = servico([UN('UN-1', 'comodato', { coluna: 'C', comodatoClienteId: 7 })]);
    await svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'A', andar: '0', caixaMaster: '27.000' }, 1, 'h');
    expect(updates[0].data).toMatchObject({ coluna: 'A', andar: '0', comodatoClienteId: null, comodatoEm: null });
  });

  it('peça em comodato NÃO entra na pronta-entrega', async () => {
    const { svc } = servico([
      UN('UN-1', 'em_estoque', { coluna: 'A', andar: '0' }),
      UN('UN-2', 'comodato', { coluna: 'C', comodatoClienteId: 7 }),
    ]);
    const [linha] = (await svc.prontaEntrega(1, [5])) as Array<{ separavel: number; livre: number; comodato: number }>;
    expect(linha.livre).toBe(1);
    expect(linha.separavel).toBe(1);
    expect(linha.comodato).toBe(1);
  });

  it('resume quanto cada cliente está guardando', async () => {
    const { svc } = servico([
      UN('UN-1', 'comodato', { comodatoClienteId: 7, comodatoEm: new Date('2026-10-20') }),
      UN('UN-2', 'comodato', { comodatoClienteId: 7, comodatoEm: new Date('2026-10-28') }),
      UN('UN-3', 'comodato', { comodatoClienteId: 7, tamanho: 'G', comodatoEm: new Date('2026-10-28') }),
    ]);
    const [loja] = await svc.comodatoResumo(1);
    expect(loja.cliente).toBe('INTS BICAS');
    expect(loja.total).toBe(3);
    expect(loja.desde).toEqual(new Date('2026-10-20'));
    expect(loja.itens.map((i) => [i.tamanho, i.quantidade])).toEqual([['M', 2], ['G', 1]]);
  });
});
