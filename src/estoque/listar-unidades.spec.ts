/**
 * A tela de Estoque carrega tudo de uma vez e filtra no navegador — e a
 * primeira coisa que ela fazia era jogar fora as despachadas, que são 68% das
 * etiquetas (13.776 de 20.277 em produção). Dois terços do payload existiam
 * só para serem descartados.
 *
 * Agora a listagem devolve o ARMAZÉM. O histórico de saídas continua
 * acessível, mas só quando pedido — e a contagem dele vem do banco.
 */
import { EstoqueService } from './estoque.service';

function servico() {
  const chamadas: Array<Record<string, unknown>> = [];
  const prisma = {
    unidadeEstoque: {
      findMany: (a: { where: Record<string, unknown> }) => {
        chamadas.push(a.where);
        return Promise.resolve([]);
      },
      groupBy: () => Promise.resolve([
        { status: 'despachado', _count: { _all: 13776 } },
        { status: 'reservado', _count: { _all: 2810 } },
        { status: 'em_estoque', _count: { _all: 2116 } },
        { status: 'aguardando_endereco', _count: { _all: 1575 } },
      ]),
    },
    pedido: { findMany: () => Promise.resolve([]) },
    expedicao: { findMany: () => Promise.resolve([]) },
    produto: { findMany: () => Promise.resolve([]) },
    material: { findMany: () => Promise.resolve([]) },
    cliente: { findMany: () => Promise.resolve([]) },
  };
  return { svc: new EstoqueService(prisma as never), chamadas };
}

describe('listagem de etiquetas', () => {
  it('sem filtro, NÃO traz as despachadas (são 68% do payload)', async () => {
    const { svc, chamadas } = servico();
    await svc.listarUnidades(1);
    expect(chamadas[0].status).toEqual({ not: 'despachado' });
  });

  it('o histórico de saídas continua acessível, sob demanda', async () => {
    const { svc, chamadas } = servico();
    await svc.listarUnidades(1, 'despachado');
    expect(chamadas[0].status).toBe('despachado');
  });

  it('um status pedido manda sobre o padrão', async () => {
    const { svc, chamadas } = servico();
    await svc.listarUnidades(1, 'comodato');
    expect(chamadas[0].status).toBe('comodato');
  });

  it('a busca por texto não reabre a porta das despachadas', async () => {
    const { svc, chamadas } = servico();
    await svc.listarUnidades(1, undefined, 'CALCA');
    expect(chamadas[0].status).toEqual({ not: 'despachado' });
    expect(chamadas[0].OR).toBeDefined();
  });
});

describe('contagem por status', () => {
  it('conta no banco, para a tela não precisar das linhas', async () => {
    const { svc } = servico();
    const r = await svc.contagemPorStatus(1);
    expect(r.despachadas).toBe(13776);
    // O que está no armazém é tudo menos o histórico de saídas.
    expect(r.noArmazem).toBe(2810 + 2116 + 1575);
    expect(r.porStatus.em_estoque).toBe(2116);
  });
});
