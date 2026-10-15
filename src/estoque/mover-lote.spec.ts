/**
 * Movimentar VÁRIAS etiquetas de uma vez.
 *
 * A gaveta do estoque já tinha "selecionar tudo", mas o botão "Movimentar"
 * ignorava a seleção: abria a tela de movimentação vazia, que mexe no agregado
 * por produto+tamanho. Guardar um fardo era uma bipagem por etiqueta.
 */
import { EstoqueService } from './estoque.service';

const UN = (codigo: string, status: string) => ({ codigo, status, empresaId: 1, descricao: 'Calça', tamanho: 'P' });

function servico(unidades: Array<ReturnType<typeof UN>>) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const prisma = {
    unidadeEstoque: {
      findMany: ({ where }: { where: { codigo?: { in: string[] } } }) =>
        Promise.resolve(unidades.filter((u) => !where.codigo || where.codigo.in.includes(u.codigo))),
      updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(a);
        const ids = ((a.where.codigo as { in: string[] })?.in) ?? [];
        return Promise.resolve({ count: ids.length });
      },
    },
    material: { findMany: () => Promise.resolve([]) },
    log: { create: () => Promise.resolve({}) },
  };
  return { svc: new EstoqueService(prisma as never), updates };
}

describe('endereçar várias etiquetas', () => {
  it('manda todas para o mesmo endereço numa escrita só', async () => {
    const { svc, updates } = servico([UN('UN-1', 'em_estoque'), UN('UN-2', 'aguardando_endereco')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1', 'UN-2'], coluna: 'A', andar: '3' }, 1, 'herberth');
    expect(r.enderecadas).toBe(2);
    expect(r.endereco).toBe('Coluna A · Andar 3');
    expect(updates[0].data).toMatchObject({ coluna: 'A', andar: '3' });
  });

  it('peça RESERVADA muda de lugar mas continua reservada', async () => {
    const { svc, updates } = servico([UN('UN-1', 'reservado'), UN('UN-2', 'em_estoque')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1', 'UN-2'], coluna: 'B', andar: '1' }, 1, 'h');
    expect(r.reservadas).toBe(1);
    // o update de status só pega a que NÃO está reservada
    const statusUpd = updates.find((u) => u.data.status === 'em_estoque');
    expect((statusUpd?.where.codigo as { in: string[] }).in).toEqual(['UN-2']);
  });

  it('ignora despachada e avisa quais foram', async () => {
    const { svc } = servico([UN('UN-1', 'despachado'), UN('UN-2', 'em_estoque')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1', 'UN-2'], coluna: 'A', andar: '0' }, 1, 'h');
    expect(r.enderecadas).toBe(1);
    expect(r.ignoradas.despachadas).toEqual(['UN-1']);
  });

  it('código repetido conta uma vez só', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque')]);
    const r = await svc.enderecarVarias({ codigos: ['UN-1', 'UN-1', ' UN-1 '], coluna: 'A', andar: '2' }, 1, 'h');
    expect(r.enderecadas).toBe(1);
  });

  it('exige coluna e andar', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque')]);
    await expect(svc.enderecarVarias({ codigos: ['UN-1'], coluna: '', andar: '2' }, 1, 'h')).rejects.toThrow(/coluna e o andar/i);
  });

  it('sem seleção não faz nada', async () => {
    const { svc } = servico([]);
    await expect(svc.enderecarVarias({ codigos: [], coluna: 'A', andar: '1' }, 1, 'h')).rejects.toThrow(/ao menos uma etiqueta/i);
  });

  it('tudo despachado: recusa em vez de dizer que endereçou zero', async () => {
    const { svc } = servico([UN('UN-1', 'despachado')]);
    await expect(svc.enderecarVarias({ codigos: ['UN-1'], coluna: 'A', andar: '1' }, 1, 'h')).rejects.toThrow(/Nenhuma etiqueta/i);
  });
});

describe('baixa em lote', () => {
  it('baixa as selecionadas', async () => {
    const { svc, updates } = servico([UN('UN-1', 'em_estoque'), UN('UN-2', 'aguardando_endereco')]);
    const r = await svc.saidaVarias({ codigos: ['UN-1', 'UN-2'], motivo: 'perda' }, 1, 'h');
    expect(r.baixadas).toBe(2);
    expect(updates[0].data).toMatchObject({ status: 'despachado' });
  });

  it('RECUSA o lote inteiro se houver peça reservada — ela some do pedido', async () => {
    const { svc } = servico([UN('UN-1', 'em_estoque'), UN('UN-2', 'reservado')]);
    await expect(svc.saidaVarias({ codigos: ['UN-1', 'UN-2'] }, 1, 'h')).rejects.toThrow(/RESERVADAS para expedição/i);
  });

  it('despachada não baixa de novo', async () => {
    const { svc } = servico([UN('UN-1', 'despachado')]);
    await expect(svc.saidaVarias({ codigos: ['UN-1'] }, 1, 'h')).rejects.toThrow(/Nenhuma etiqueta disponível/i);
  });
});

describe('endereços usados', () => {
  it('devolve coluna, andar e caixa distintos e ordenados', async () => {
    const prisma = {
      unidadeEstoque: {
        findMany: () => Promise.resolve([
          { coluna: 'B', andar: '10', caixaMaster: '2.000' },
          { coluna: 'A', andar: '2', caixaMaster: null },
          { coluna: 'A', andar: '2', caixaMaster: '1.000' },
          { coluna: ' ', andar: null, caixaMaster: '' },
        ]),
      },
      material: { findMany: () => Promise.resolve([{ localizacao: 'B3' }, { localizacao: null }]) },
      log: { create: () => Promise.resolve({}) },
    };
    const svc = new EstoqueService(prisma as never);
    const r = await svc.enderecosUsados(1);
    expect(r.colunas).toEqual(['A', 'B']);
    expect(r.andares).toEqual(['2', '10']); // numérico: 2 antes de 10, não "10" antes de "2"
    expect(r.caixas).toEqual(['1.000', '2.000']);
    expect(r.localizacoesMaterial).toEqual(['B3']);
  });
});
