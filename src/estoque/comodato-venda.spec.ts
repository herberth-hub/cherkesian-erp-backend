/**
 * VENDA DE COMODATO — o cliente vendeu, agora ele paga.
 *
 * É o ponto do ciclo onde a peça sai do estoque E vira dinheiro a receber. O
 * que estes testes prendem é justamente que as duas coisas andem juntas: nada
 * de peça baixada sem título, nada de título sobre peça que já saiu por outro
 * caminho, e nada de cobrar R$ 0,00 porque ninguém tabelou o preço.
 */
import { ComodatoVendaService } from './comodato-venda.service';

const UN = (codigo: string, extra: Record<string, unknown> = {}) => ({
  codigo, status: 'comodato', empresaId: 1, descricao: 'CALCA PROFISSIONAL', cor: 'VERDE',
  tamanho: 'M', produtoId: 5, qualidade: 'primeira', comodatoClienteId: 7, ...extra,
});

const CLIENTE = { id: 7, nome: 'INTS BICAS COMERCIO LTDA', fantasia: 'INTS BICAS', representante: 'MARCELLO', comissaoPercent: 5, comissaoComImposto: false };
const PRODUTO = { id: 5, codigo: 'PRD-CAL-0005', descricao: 'CALCA PROFISSIONAL', precoBase: 60, precoEspecial: 75, tamsEspeciais: 'G1,G2,G3' };

type Escritas = {
  pedidos: Array<Record<string, unknown>>;
  baixas: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  titulos: Array<Record<string, unknown>>;
};

function servico(
  unidades: Array<ReturnType<typeof UN>>,
  opts: { contratos?: unknown[]; produtos?: unknown[]; baixaCount?: number } = {},
) {
  const esc: Escritas = { pedidos: [], baixas: [], titulos: [] };
  const tx = {
    pedido: {
      create: (a: { data: Record<string, unknown> }) => {
        esc.pedidos.push(a.data);
        return Promise.resolve({ id: 900, numero: a.data.numero });
      },
    },
    unidadeEstoque: {
      updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        esc.baixas.push(a);
        const n = opts.baixaCount ?? ((a.where.codigo as { in: string[] })?.in ?? []).length;
        return Promise.resolve({ count: n });
      },
    },
    contaReceber: {
      createMany: (a: { data: Array<Record<string, unknown>> }) => {
        esc.titulos.push(...a.data);
        return Promise.resolve({ count: a.data.length });
      },
    },
  };
  const prisma = {
    unidadeEstoque: {
      findMany: ({ where }: { where: { codigo: { in: string[] } } }) =>
        Promise.resolve(unidades.filter((u) => where.codigo.in.includes(u.codigo))),
    },
    cliente: { findUnique: () => Promise.resolve(CLIENTE) },
    contrato: { findMany: () => Promise.resolve(opts.contratos ?? []) },
    produto: { findMany: () => Promise.resolve(opts.produtos ?? [PRODUTO]) },
    pedido: { findMany: () => Promise.resolve([{ numero: 'PV41' }]) },
    filial: { findFirst: () => Promise.resolve({ id: 2, empresaId: 1, matriz: true, ativa: true }), findUnique: () => Promise.resolve({ id: 3, empresaId: 1, ativa: true }) },
    contaReceber: { createMany: tx.contaReceber.createMany },
    log: { create: () => Promise.resolve({}) },
    $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  return { svc: new ComodatoVendaService(prisma as never), esc };
}

const CONTRATO = {
  id: 2, numero: 'CT-002', filialId: 3, vendedor: 'HERBERTH',
  formaPagamento: 'Boleto', condicaoPagamento: '30/60',
  itens: [{ produtoId: 5, preco: 48 }],
};

describe('prévia da venda de comodato', () => {
  it('usa o preço do CONTRATO do cliente, não a tabela do produto', async () => {
    const { svc } = servico([UN('UN-1'), UN('UN-2')], { contratos: [CONTRATO] });
    const p = await svc.previa(['UN-1', 'UN-2'], 1);
    expect(p.cliente).toBe('INTS BICAS');
    expect(p.linhas[0].precoUnit).toBe(48);
    expect(p.linhas[0].precoOrigem).toBe('contrato');
    expect(p.linhas[0].contrato).toBe('CT-002');
    expect(p.total).toBe(96);
  });

  it('sem contrato, cai na tabela do produto', async () => {
    const { svc } = servico([UN('UN-1')]);
    const p = await svc.previa(['UN-1'], 1);
    expect(p.linhas[0].precoOrigem).toBe('tabela');
    expect(p.total).toBe(60);
  });

  it('tamanho da faixa especial entra pelo preço especial', async () => {
    // Grade MISTA (M + G2): o preço de contrato vale no M e o especial no G2.
    const { svc } = servico([UN('UN-1'), UN('UN-2', { tamanho: 'G2' })], { contratos: [CONTRATO] });
    const p = await svc.previa(['UN-1', 'UN-2'], 1);
    expect(p.total).toBe(48 + 75);
  });

  it('produto sem preço nenhum é apontado, não cobrado a zero', async () => {
    const { svc } = servico([UN('UN-1')], { produtos: [{ ...PRODUTO, precoBase: null }] });
    const p = await svc.previa(['UN-1'], 1);
    expect(p.semPreco).toHaveLength(1);
    expect(p.total).toBe(0);
  });

  it('aceita preço informado na hora quando nada tabela o produto', async () => {
    const { svc } = servico([UN('UN-1')], { produtos: [{ ...PRODUTO, precoBase: null }] });
    const p = await svc.previa(['UN-1'], 1, { '5': 52 });
    expect(p.semPreco).toHaveLength(0);
    expect(p.linhas[0].precoOrigem).toBe('informado');
    expect(p.total).toBe(52);
  });
});

describe('registrar a venda', () => {
  it('cria o pedido, baixa as peças e lança o título na mesma transação', async () => {
    const { svc, esc } = servico([UN('UN-1'), UN('UN-2')], { contratos: [CONTRATO] });
    const r = await svc.registrarVenda({ codigos: ['UN-1', 'UN-2'] }, 1, 'herberth');

    expect(r.pedido).toBe('PV42');
    expect(r.total).toBe(96);
    // Pedido nasce entregue: a mercadoria já estava com o cliente.
    const ped = esc.pedidos[0] as { etapa: string; comissaoRepresentante: string; itens: { create: Array<{ quantidade: number; quantidadeExpedida: number; grade: unknown }> } };
    expect(ped.etapa).toBe('concluido');
    expect(ped.comissaoRepresentante).toBe('HERBERTH');
    expect(ped.itens.create[0]).toMatchObject({ quantidade: 2, quantidadeExpedida: 2, grade: { M: 2 } });
    // Peças fora do estoque, amarradas ao pedido que as cobrou.
    expect(esc.baixas[0].data).toMatchObject({ status: 'despachado', pedidoId: 900 });
    // 30/60 do contrato = duas parcelas que somam o total.
    expect(esc.titulos).toHaveLength(2);
    expect(esc.titulos.reduce((s, t) => s + Number(t.valor), 0)).toBe(96);
    expect(esc.titulos[0]).toMatchObject({ pedidoId: 900, clienteId: 7, documento: 'PV42' });
  });

  it('título amarrado ao pedido — é o que faz a comissão sair na quitação', async () => {
    const { svc, esc } = servico([UN('UN-1')], { contratos: [CONTRATO] });
    await svc.registrarVenda({ codigos: ['UN-1'] }, 1, 'h');
    expect(esc.titulos.every((t) => t.pedidoId === 900)).toBe(true);
  });

  it('recusa etiqueta que não está em comodato', async () => {
    const { svc, esc } = servico([UN('UN-1'), UN('UN-2', { status: 'em_estoque' })]);
    await expect(svc.registrarVenda({ codigos: ['UN-1', 'UN-2'] }, 1, 'h')).rejects.toThrow(/não estão em comodato/i);
    expect(esc.pedidos).toHaveLength(0);
  });

  it('recusa etiquetas de clientes diferentes na mesma venda', async () => {
    const { svc } = servico([UN('UN-1'), UN('UN-2', { comodatoClienteId: 9 })]);
    await expect(svc.registrarVenda({ codigos: ['UN-1', 'UN-2'] }, 1, 'h')).rejects.toThrow(/clientes diferentes/i);
  });

  it('não lança venda sem preço — nem a peça sai nem o título entra', async () => {
    const { svc, esc } = servico([UN('UN-1')], { produtos: [{ ...PRODUTO, precoBase: null }] });
    await expect(svc.registrarVenda({ codigos: ['UN-1'] }, 1, 'h')).rejects.toThrow(/Sem preço/i);
    expect(esc.pedidos).toHaveLength(0);
    expect(esc.titulos).toHaveLength(0);
  });

  it('peça que saiu do comodato no meio do caminho aborta a venda inteira', async () => {
    const { svc } = servico([UN('UN-1'), UN('UN-2')], { contratos: [CONTRATO], baixaCount: 1 });
    await expect(svc.registrarVenda({ codigos: ['UN-1', 'UN-2'] }, 1, 'h')).rejects.toThrow(/saíram do comodato/i);
  });

  it('vencimento informado manda em cima do prazo do contrato', async () => {
    const { svc, esc } = servico([UN('UN-1')], { contratos: [CONTRATO] });
    await svc.registrarVenda({ codigos: ['UN-1'], vencimento: '2026-12-05' }, 1, 'h');
    expect(esc.titulos).toHaveLength(1);
    expect((esc.titulos[0].vencimento as Date).toISOString().slice(0, 10)).toBe('2026-12-05');
  });

  it('vencimento inválido é recusado antes de qualquer escrita', async () => {
    const { svc, esc } = servico([UN('UN-1')], { contratos: [CONTRATO] });
    await expect(svc.registrarVenda({ codigos: ['UN-1'], vencimento: 'ontem' }, 1, 'h')).rejects.toThrow(/Vencimento inválido/i);
    expect(esc.pedidos).toHaveLength(0);
  });
});
