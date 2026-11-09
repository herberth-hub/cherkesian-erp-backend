/**
 * VÁRIOS ITENS NUMA ORDEM DE COMPRA.
 *
 * A OC nasceu com um item só, então comprar duas cores do mesmo zíper virava
 * duas ordens (OC-0057 Royal e OC-0058 Verde Bandeira) — dois documentos para o
 * mesmo fornecedor, na mesma compra. O mesmo aconteceu com o brim da Vinatex.
 *
 * Agora a ordem tem linhas. O cabeçalho vira o RESUMO (descrição, quantidade e
 * valor totais) para que tudo que já lia `valor` — a pagar, dashboards,
 * relatórios — continue lendo dinheiro certo; e quem precisa saber o que a
 * ordem repõe passa pelos itens.
 *
 * Ordem SEM item nenhum continua sendo a de item único de sempre: é assim que as
 * 60 ordens antigas seguem funcionando.
 */
import { Prisma } from '@prisma/client';
import { ComprasService } from './compras.service';

const D = (n: number | string) => new Prisma.Decimal(n);

function servico(estado: { ocs?: unknown[] } = {}) {
  const criadas: Array<Record<string, unknown>> = [];
  const atualizadas: Array<Record<string, unknown>> = [];
  const ocs = (estado.ocs ?? []) as Array<Record<string, unknown>>;
  const prisma = {
    fornecedor: { findUnique: ({ where }: never) => Promise.resolve({ id: (where as { id: number }).id, empresaId: 1 }) },
    material: {
      findUnique: ({ where }: never) => Promise.resolve({ id: (where as { id: number }).id, empresaId: 1 }),
      findMany: ({ where }: { where: { id: { in: number[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id, empresaId: 1 }))),
      update: (args: Record<string, unknown>) => { atualizadas.push(args); return Promise.resolve({}); },
    },
    produto: {
      findUnique: ({ where }: never) => Promise.resolve({ id: (where as { id: number }).id, empresaId: 1 }),
      findMany: ({ where }: { where: { id: { in: number[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id, empresaId: 1 }))),
    },
    ordemCompra: {
      findMany: () => Promise.resolve(ocs),
      findUnique: ({ where }: { where: { id: number } }) => Promise.resolve(ocs.find((o) => o.id === where.id) ?? null),
      create: (args: Record<string, unknown>) => { criadas.push(args); return Promise.resolve({ numero: 'OC-0099', ...(args.data as object) }); },
      update: (args: Record<string, unknown>) => { atualizadas.push(args); return Promise.resolve({}); },
      updateMany: (args: Record<string, unknown>) => { atualizadas.push(args); return Promise.resolve({ count: 2 }); },
      count: () => Promise.resolve(0),
    },
    notaEntrada: { findFirst: () => Promise.resolve(null) },
    $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  };
  const svc = new ComprasService(prisma as never);
  (svc as unknown as { gerarNumero: () => Promise<string> }).gerarNumero = () => Promise.resolve('OC-0099');
  return { svc, criadas, atualizadas };
}

describe('criar ordem com vários itens', () => {
  const DOIS_ITENS = {
    fornecedorId: 106,
    filialId: 3,
    itens: [
      { materialId: 796, descricao: 'ZÍPER DESTACÁVEL NYLON Nº 5 50 CM · Royal', quantidade: 40, unidade: 'un', valorUnit: 1.215 },
      { materialId: 797, descricao: 'ZÍPER DESTACÁVEL NYLON Nº 5 50 CM · Verde Bandeira', quantidade: 15, unidade: 'un', valorUnit: 1.215 },
    ],
  } as never;

  it('grava uma linha por item, com o total calculado do unitário', async () => {
    const { svc, criadas } = servico();
    await svc.create(DOIS_ITENS, 1);
    const itens = (criadas[0].data as { itens: { create: Array<Record<string, unknown>> } }).itens.create;
    expect(itens).toHaveLength(2);
    expect(Number(itens[0].valor)).toBeCloseTo(48.60, 2); // 40 x 1,215
    expect(Number(itens[1].valor)).toBeCloseTo(18.23, 2); // 15 x 1,215 -> 18,225 -> 18,23
    expect(itens[0].ordem).toBe(0);
    expect(itens[1].ordem).toBe(1);
  });

  /** O preço com 10% de desconto no PIX é R$ 1,215 — 3 casas. Arredondar aqui perderia centavo. */
  it('guarda o preço unitário com casas suficientes p/ o desconto do PIX', async () => {
    const { svc, criadas } = servico();
    await svc.create(DOIS_ITENS, 1);
    const itens = (criadas[0].data as { itens: { create: Array<Record<string, unknown>> } }).itens.create;
    expect(Number(itens[0].valorUnit)).toBe(1.215);
  });

  it('o cabeçalho vira o RESUMO — é dele que o a-pagar e os relatórios leem', async () => {
    const { svc, criadas } = servico();
    await svc.create(DOIS_ITENS, 1);
    const h = criadas[0].data as Record<string, unknown>;
    expect(Number(h.valor)).toBeCloseTo(66.83, 2);  // 48,60 + 18,23
    expect(Number(h.quantidade)).toBe(55);          // mesma unidade: soma
    expect(h.unidade).toBe('un');
    expect(String(h.descricao)).toMatch(/^2 itens/);
    // material/produto saem do cabeçalho: agora moram nas linhas
    expect(h.materialId).toBeNull();
    expect(h.produtoId).toBeNull();
  });

  /** Somar 240 m com 40 un daria um número que não quer dizer nada. */
  it('unidades diferentes: a quantidade do cabeçalho vira a CONTAGEM de itens', async () => {
    const { svc, criadas } = servico();
    await svc.create({
      fornecedorId: 112,
      itens: [
        { materialId: 120, descricao: 'BRIM PRETO', quantidade: 240, unidade: 'm', valorUnit: 14.6 },
        { materialId: 796, descricao: 'ZÍPER', quantidade: 40, unidade: 'un', valorUnit: 1.35 },
      ],
    } as never, 1);
    const h = criadas[0].data as Record<string, unknown>;
    expect(Number(h.quantidade)).toBe(2);
    expect(h.unidade).toBe('itens');
    expect(Number(h.valor)).toBeCloseTo(240 * 14.6 + 40 * 1.35, 2);
  });

  it('recusa material de outra empresa', async () => {
    const { svc } = servico();
    const prismaVazio = { material: { findMany: () => Promise.resolve([]) }, produto: { findMany: () => Promise.resolve([]) } };
    (svc as unknown as { prisma: unknown }).prisma = {
      ...prismaVazio,
      fornecedor: { findUnique: () => Promise.resolve({ id: 1, empresaId: 1 }) },
    };
    await expect(svc.create({ fornecedorId: 1, itens: [{ materialId: 999, descricao: 'x', quantidade: 1, unidade: 'un', valorUnit: 1 }] } as never, 1))
      .rejects.toThrow(/Material 999 não encontrado/);
  });

  /** A ordem de item único não pode ter mudado de comportamento. */
  it('sem `itens`, continua sendo a ordem de uma linha de sempre', async () => {
    const { svc, criadas } = servico();
    await svc.create({ fornecedorId: 106, materialId: 796, descricao: 'ZÍPER · Royal', quantidade: 40, unidade: 'un', valor: 54 } as never, 1);
    const h = criadas[0].data as Record<string, unknown>;
    expect(h.materialId).toBe(796);
    expect(h.itens).toBeUndefined();
    expect(Number(h.valor)).toBe(54);
  });
});

describe('receber a ordem', () => {
  it('ordem com itens repõe CADA material pela quantidade da linha', async () => {
    const oc = {
      id: 9, numero: 'OC-0099', status: 'aguardando', materialId: null, quantidade: D(55),
      fornecedor: { empresaId: 1, nome: 'JOSELMA' },
      itens: [
        { materialId: 796, quantidade: D(40) },
        { materialId: 797, quantidade: D(15) },
      ],
    };
    const { svc, atualizadas } = servico({ ocs: [oc] });
    await svc.receber(9, 1, true);
    const reposicoes = atualizadas.filter((a) => (a.data as { saldo?: unknown }).saldo);
    expect(reposicoes).toHaveLength(2);
    expect(reposicoes.map((r) => (r.where as { id: number }).id).sort()).toEqual([796, 797]);
    expect(Number((reposicoes[0].data as { saldo: { increment: unknown } }).saldo.increment)).toBe(40);
    expect(Number((reposicoes[1].data as { saldo: { increment: unknown } }).saldo.increment)).toBe(15);
  });

  it('ordem de item único repõe pelo cabeçalho, como sempre', async () => {
    const oc = { id: 8, numero: 'OC-0050', status: 'aguardando', materialId: 521, quantidade: D(80), fornecedor: { empresaId: 1, nome: 'X' }, itens: [] };
    const { svc, atualizadas } = servico({ ocs: [oc] });
    await svc.receber(8, 1, true);
    const rep = atualizadas.filter((a) => (a.data as { saldo?: unknown }).saldo);
    expect(rep).toHaveLength(1);
    expect((rep[0].where as { id: number }).id).toBe(521);
    expect(Number((rep[0].data as { saldo: { increment: unknown } }).saldo.increment)).toBe(80);
  });
});

describe('unificar ordens', () => {
  const base = (id: number, numero: string, extra: Record<string, unknown> = {}) => ({
    id, numero, status: 'aguardando', fornecedorId: 106, filialId: 3, enviadaEm: null,
    materialId: 790 + id, produtoId: null, grade: null, codigoFornecedor: null, descricaoFornecedor: null,
    descricao: `ITEM ${numero}`, quantidade: D(10), unidade: 'un', valor: D(20), previsao: null, motivo: null,
    fornecedor: { empresaId: 1, nome: 'JOSELMA' }, itens: [],
    ...extra,
  });

  it('junta duas ordens numa só e CANCELA as originais apontando para a nova', async () => {
    const { svc, criadas, atualizadas } = servico({ ocs: [base(1, 'OC-0057'), base(2, 'OC-0058')] });
    const nova = await svc.unificar([1, 2], 1);
    const itens = (criadas[0].data as { itens: { create: Array<Record<string, unknown>> } }).itens.create;
    expect(itens).toHaveLength(2);
    expect(Number((criadas[0].data as { valor: unknown }).valor)).toBe(40);
    expect(nova.unificou).toEqual(['OC-0057', 'OC-0058']);
    const cancel = atualizadas.find((a) => (a.data as { status?: string }).status === 'cancelada');
    expect(cancel).toBeDefined();
    expect((cancel!.data as { motivo: string }).motivo).toBe('Unificada na OC-0099');
    expect((criadas[0].data as { motivo: string }).motivo).toMatch(/Unificada de OC-0057, OC-0058/);
  });

  /** A ordem antiga só guarda o total; o unitário tem de ser reconstruído. */
  it('recalcula o preço unitário da ordem antiga (total ÷ quantidade)', async () => {
    const { svc, criadas } = servico({ ocs: [base(1, 'OC-0057', { quantidade: D(40), valor: D('48.60') }), base(2, 'OC-0058', { quantidade: D(15), valor: D('18.23') })] });
    await svc.unificar([1, 2], 1);
    const itens = (criadas[0].data as { itens: { create: Array<Record<string, unknown>> } }).itens.create;
    expect(Number(itens[0].valorUnit)).toBeCloseTo(1.215, 3);
  });

  it('recusa unificar ordem JÁ ENVIADA — o fornecedor já viu aquele documento', async () => {
    const { svc } = servico({ ocs: [base(1, 'OC-0057'), base(2, 'OC-0058', { enviadaEm: new Date('2026-11-09') })] });
    await expect(svc.unificar([1, 2], 1)).rejects.toThrow(/já foi enviada/i);
  });

  it('recusa unificar ordem que já andou (recebida/cancelada)', async () => {
    const { svc } = servico({ ocs: [base(1, 'OC-0057'), base(2, 'OC-0058', { status: 'recebida' })] });
    await expect(svc.unificar([1, 2], 1)).rejects.toThrow(/não está aguardando/i);
  });

  it('recusa fornecedores diferentes — cada um recebe o documento dele', async () => {
    const { svc } = servico({ ocs: [base(1, 'OC-0057'), base(2, 'OC-0059', { fornecedorId: 112 })] });
    await expect(svc.unificar([1, 2], 1)).rejects.toThrow(/fornecedores diferentes/i);
  });

  it('recusa CNPJs compradores diferentes', async () => {
    const { svc } = servico({ ocs: [base(1, 'OC-0057'), base(2, 'OC-0058', { filialId: 5 })] });
    await expect(svc.unificar([1, 2], 1)).rejects.toThrow(/compradores diferentes/i);
  });

  it('exige ao menos 2 ordens', async () => {
    const { svc } = servico({ ocs: [base(1, 'OC-0057')] });
    await expect(svc.unificar([1], 1)).rejects.toThrow(/ao menos 2/i);
    await expect(svc.unificar([1, 1], 1)).rejects.toThrow(/ao menos 2/i);
  });
});
