/**
 * O anexo ANTIGO só sai do balde depois que o banco confirmou.
 *
 * Caso real: PRD-CAM-0078. O save subiu a foto nova, apagou a velha do balde e
 * a gravação não foi adiante — a coluna continuou apontando para um objeto que
 * já não existia, e o catálogo mostrou um quadro quebrado para sempre. Apagar
 * primeiro troca "perdi a edição" por "perdi a foto", que não tem volta.
 */
import { ProdutosService } from './produtos.service';

const DATA_URI = 'data:image/png;base64,AAAA';

/** Dobra do ArquivosService: guarda devolve ref nova, remover só anota. */
function balde() {
  const removidos: string[] = [];
  let n = 0;
  return {
    removidos,
    servico: {
      ligado: true,
      guardar: (_v: string, pasta: string) => Promise.resolve(`arq:${pasta}/novo-${++n}.jpg`),
      remover: (v: string) => { removidos.push(v); return Promise.resolve(); },
      url: () => null,
    } as never,
  };
}

describe('anexo antigo sobrevive a uma gravação que falha', () => {
  it('update que falha NÃO apaga a foto anterior do balde', async () => {
    const b = balde();
    const prisma = {
      produto: { findUnique: () => Promise.resolve({ id: 1, empresaId: 1, fotoModelo: 'arq:produtos/velha.jpg' }) },
      $transaction: () => Promise.reject(new Error('P2028: transação derrubada')),
    };
    const svc = new ProdutosService(prisma as never, b.servico);
    jest.spyOn(svc, 'findOne').mockResolvedValue({ fotoModelo: 'arq:produtos/velha.jpg' } as never);

    await expect(svc.update(1, { fotoModelo: DATA_URI } as never, 1)).rejects.toThrow(/P2028/);
    expect(b.removidos).toEqual([]); // a velha continua lá — a coluna ainda aponta para ela
  });

  it('update que dá certo apaga a anterior', async () => {
    const b = balde();
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => Promise.resolve(fn({
      produto: { update: () => Promise.resolve({ id: 1 }) },
      produtoMedida: { deleteMany: () => Promise.resolve({}), createMany: () => Promise.resolve({}) },
      consumo: { findFirst: () => Promise.resolve(null), create: () => Promise.resolve({}) },
    })) };
    const svc = new ProdutosService(prisma as never, b.servico);
    jest.spyOn(svc, 'findOne').mockResolvedValue({ fotoModelo: 'arq:produtos/velha.jpg' } as never);

    await svc.update(1, { fotoModelo: DATA_URI } as never, 1);
    expect(b.removidos).toEqual(['arq:produtos/velha.jpg']);
  });

  it('limpar o campo também só apaga depois do commit', async () => {
    const b = balde();
    const prisma = { $transaction: () => Promise.reject(new Error('caiu')) };
    const svc = new ProdutosService(prisma as never, b.servico);
    jest.spyOn(svc, 'findOne').mockResolvedValue({ fotoModelo: 'arq:produtos/velha.jpg' } as never);

    await expect(svc.update(1, { fotoModelo: '' } as never, 1)).rejects.toThrow();
    expect(b.removidos).toEqual([]);
  });

  it('mockup da cor: update que falha não deixa a cor sem imagem', async () => {
    const b = balde();
    const prisma = {
      produto: { findUnique: () => Promise.resolve({ id: 1, empresaId: 1, cor: 'PRETO' }) },
      produtoCor: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ produtoId: 1 })
          .mockResolvedValueOnce({ mockupFrente: 'arq:mockups/velho.jpg', mockupCostas: null }),
        update: () => Promise.reject(new Error('caiu na hora de gravar')),
      },
    };
    const svc = new ProdutosService(prisma as never, b.servico);

    await expect(svc.atualizarCor(1, 9, 1, { mockupFrente: DATA_URI })).rejects.toThrow(/caiu/);
    expect(b.removidos).toEqual([]);
  });
});
