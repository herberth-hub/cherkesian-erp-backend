/**
 * PRONTA ENTREGA: o que já está no armazém e não precisa ser produzido de novo.
 *
 * O pedido entrava e a OP mandava cortar a grade inteira, mesmo quando a peça
 * já existia etiquetada na prateleira. Aqui provamos as duas coisas que fazem
 * esse número ser confiável: QUEM pode ser separado (e quem não pode) e QUANTO
 * do pedido aquilo cobre.
 */
import { EstoqueService } from './estoque.service';
import { PedidosService } from '../pedidos/pedidos.service';

type Un = {
  codigo: string; produtoId: number; cor: string | null; tamanho: string | null; status: string;
  coluna?: string | null; andar?: string | null; caixaMaster?: string | null;
  pedidoId?: number | null; qualidade?: string | null;
};
const UN = (codigo: string, status: string, extra: Partial<Un> = {}): Un => ({
  codigo, produtoId: 10, cor: 'BRANCO', tamanho: 'G', status,
  coluna: 'A', andar: '0', caixaMaster: null, pedidoId: null, qualidade: 'primeira', ...extra,
});

const servicoEstoque = (uns: Un[]) =>
  new EstoqueService({ unidadeEstoque: { findMany: () => Promise.resolve(uns) } } as never);

describe('estoque pronta-entrega', () => {
  it('conta peça em estoque como separável, com endereço e etiqueta', async () => {
    const svc = servicoEstoque([UN('UN-1', 'em_estoque'), UN('UN-2', 'em_estoque')]);
    const [l] = await svc.prontaEntrega(1, [10]);
    expect(l.livre).toBe(2);
    expect(l.separavel).toBe(2);
    expect(l.locais).toEqual([{ endereco: 'Col A · And 0', quantidade: 2 }]);
    expect(l.etiquetas.map((e) => e.codigo)).toEqual(['UN-1', 'UN-2']);
  });

  it('reservada PARA ESTE pedido conta; reservada para OUTRO não', async () => {
    const svc = servicoEstoque([
      UN('UN-1', 'reservado', { pedidoId: 54 }),
      UN('UN-2', 'reservado', { pedidoId: 99 }),
    ]);
    const [l] = await svc.prontaEntrega(1, [10], 54);
    expect(l.doPedido).toBe(1);
    expect(l.deOutro).toBe(1);
    expect(l.separavel).toBe(1);
  });

  it('sem o pedido no filtro, reservada é de outro — não entra na separação', async () => {
    const svc = servicoEstoque([UN('UN-1', 'reservado', { pedidoId: 54 })]);
    const [l] = await svc.prontaEntrega(1, [10]);
    expect(l.separavel).toBe(0);
    expect(l.deOutro).toBe(1);
  });

  /**
   * Peça aguardando endereço existe, mas ninguém sabe onde ela está. Mandar a
   * expedição buscar é mandar procurar no armazém inteiro — fica de fora do
   * separável e aparece no contador próprio, p/ a tela explicar o porquê.
   */
  it('sem endereço não é separável, mas é contada', async () => {
    const svc = servicoEstoque([UN('UN-1', 'aguardando_endereco', { coluna: null, andar: null })]);
    const [l] = await svc.prontaEntrega(1, [10]);
    expect(l.semEndereco).toBe(1);
    expect(l.separavel).toBe(0);
  });

  it('segunda linha fica fora da separação automática', async () => {
    const svc = servicoEstoque([UN('UN-1', 'em_estoque', { qualidade: 'segunda' }), UN('UN-2', 'em_estoque')]);
    const [l] = await svc.prontaEntrega(1, [10]);
    expect(l.segunda).toBe(1);
    expect(l.separavel).toBe(1);
    expect(l.etiquetas.map((e) => e.codigo)).toEqual(['UN-2']);
  });

  it('separa por cor e tamanho, e soma os endereços de cada um', async () => {
    const svc = servicoEstoque([
      UN('UN-1', 'em_estoque'),
      UN('UN-2', 'em_estoque', { andar: '3' }),
      UN('UN-3', 'em_estoque', { tamanho: 'GG' }),
      UN('UN-4', 'em_estoque', { cor: 'PRETO' }),
    ]);
    const r = await svc.prontaEntrega(1, [10]);
    expect(r).toHaveLength(3);
    const g = r.find((x) => x.tamanho === 'G' && x.cor === 'BRANCO');
    expect(g?.separavel).toBe(2);
    expect(g?.locais).toHaveLength(2);
  });

  it('sem produto não consulta o banco', async () => {
    const svc = new EstoqueService({
      unidadeEstoque: { findMany: () => { throw new Error('não deveria consultar'); } },
    } as never);
    await expect(svc.prontaEntrega(1, [])).resolves.toEqual([]);
  });
});

// ===== O quanto disso cobre o pedido =====

type Item = {
  id: number; produtoId: number | null; descricao: string; cor: string | null;
  quantidade: number; quantidadeExpedida: number; grade: unknown; gradeExpedida: unknown;
};
const ITEM = (extra: Partial<Item> = {}): Item => ({
  id: 1, produtoId: 10, descricao: 'CAMISA', cor: 'BRANCO',
  quantidade: 100, quantidadeExpedida: 0, grade: null, gradeExpedida: null, ...extra,
});

type Linha = { item: string; tamanho: string | null; falta: number; emEstoque: number; separar: number };
const doPedido = (itens: Item[], disponivel: Array<Record<string, unknown>>) => {
  const svc = new PedidosService(
    {} as never, {} as never, {} as never, {} as never,
    { prontaEntrega: async () => disponivel } as never,
  );
  return (svc as unknown as {
    prontaEntregaDoPedido(p: unknown, e: number): Promise<{ prontaEntrega: Linha[]; avisoProntaEntrega: string | null }>;
  }).prontaEntregaDoPedido({ id: 54, itens }, 1);
};
const DISP = (tamanho: string | null, separavel: number) =>
  ({ produtoId: 10, cor: 'BRANCO', tamanho, separavel, locais: [{ endereco: 'Col A · And 0', quantidade: separavel }] });

describe('quanto do pedido já está pronto', () => {
  it('separa só o que falta expedir, não a grade inteira', async () => {
    const r = await doPedido(
      [ITEM({ grade: { G: 100 }, gradeExpedida: { G: 90 } })],
      [DISP('G', 50)],
    );
    expect(r.prontaEntrega).toHaveLength(1);
    expect(r.prontaEntrega[0]).toMatchObject({ tamanho: 'G', falta: 10, emEstoque: 50, separar: 10 });
  });

  it('estoque menor que o residual separa o estoque todo', async () => {
    const r = await doPedido([ITEM({ grade: { G: 100 } })], [DISP('G', 11)]);
    expect(r.prontaEntrega[0]).toMatchObject({ falta: 100, separar: 11 });
    expect(r.avisoProntaEntrega).toContain('11 peça(s)');
    expect(r.avisoProntaEntrega).toContain('G: 11');
  });

  it('tamanho já todo expedido não entra', async () => {
    const r = await doPedido(
      [ITEM({ grade: { G: 10, GG: 10 }, gradeExpedida: { G: 10 } })],
      [DISP('G', 5), DISP('GG', 5)],
    );
    expect(r.prontaEntrega.map((l) => l.tamanho)).toEqual(['GG']);
  });

  it('item sem grade usa a quantidade e o que já saiu', async () => {
    const r = await doPedido(
      [ITEM({ quantidade: 40, quantidadeExpedida: 30 })],
      [DISP(null, 100)],
    );
    expect(r.prontaEntrega[0]).toMatchObject({ tamanho: null, falta: 10, separar: 10 });
  });

  it('nada em estoque: nenhum aviso (não assusta a produção de graça)', async () => {
    const r = await doPedido([ITEM({ grade: { G: 100 } })], [DISP('G', 0)]);
    expect(r.prontaEntrega).toEqual([]);
    expect(r.avisoProntaEntrega).toBeNull();
  });

  it('item em texto livre (sem produto) é ignorado', async () => {
    const r = await doPedido([ITEM({ produtoId: null })], []);
    expect(r.prontaEntrega).toEqual([]);
    expect(r.avisoProntaEntrega).toBeNull();
  });

  /** Cor diferente é outro produto na prateleira — não serve para este item. */
  it('estoque de outra cor não conta', async () => {
    const r = await doPedido(
      [ITEM({ grade: { G: 10 }, cor: 'PRETO' })],
      [DISP('G', 10)],
    );
    expect(r.prontaEntrega).toEqual([]);
  });
});
