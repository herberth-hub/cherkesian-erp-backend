/**
 * Baixa do tecido na geração da OP.
 *
 * PV126 (Vivara): 1.000 peças cortadas e o ALFAIATARIA TWILL não baixou nada. As
 * duas OPs nasceram com `romaneioMateriais: []` porque o produto ainda não tinha
 * ficha de consumo — e isso passou CALADO. De quebra, o decremento do saldo nunca
 * gravava MovimentoMaterial: o material ficava com um saldo que ninguém explicava
 * (saldo 1.500 e ZERO movimentos).
 */
import { Prisma } from '@prisma/client';
import { PedidosService } from './pedidos.service';
import { ArquivosService } from '../arquivos/arquivos.service';

const D = (n: number) => new Prisma.Decimal(n);

type Mov = { materialId: number; tipo: string; quantidade: Prisma.Decimal; saldoApos: Prisma.Decimal; origem: string; documento: string; unidade: string };

function servico() {
  const movs: Mov[] = [];
  const tx = { movimentoMaterial: { createMany: ({ data }: { data: Mov[] }) => { movs.push(...data); return Promise.resolve({ count: data.length }); } } };
  const svc = new PedidosService({} as never, {} as never, {} as never, new ArquivosService());
  return { svc, tx, movs };
}

const chamar = (svc: PedidosService, tx: unknown, nec: Map<number, Prisma.Decimal>, mats: Array<{ id: number; codigo: string; saldo: Prisma.Decimal; unidade: string }>) =>
  (svc as unknown as {
    registrarConsumoOp: (tx: unknown, e: number, n: Map<number, Prisma.Decimal>, m: unknown[], doc: string, u?: string) => Promise<void>;
  }).registrarConsumoOp(tx, 1, nec, mats, 'PV126', 'admin');

const MATS = [{ id: 115, codigo: 'MP-TEC-0033', saldo: D(1500), unidade: 'm' }];

describe('movimento do consumo de produção', () => {
  it('grava uma SAÍDA por material, com o saldo depois da baixa', async () => {
    const { svc, tx, movs } = servico();
    await chamar(svc, tx, new Map([[115, D(1250)]]), MATS);
    expect(movs).toHaveLength(1);
    expect(movs[0].materialId).toBe(115);
    expect(movs[0].tipo).toBe('saida');
    expect(movs[0].quantidade.toFixed(3)).toBe('1250.000');
    // 1.500 em estoque − 1.250 consumidos
    expect(movs[0].saldoApos.toFixed(3)).toBe('250.000');
    expect(movs[0].origem).toBe('consumo_op');
    expect(movs[0].documento).toBe('PV126');
    expect(movs[0].unidade).toBe('m');
  });

  it('vários materiais viram vários movimentos', async () => {
    const { svc, tx, movs } = servico();
    const mats = [...MATS, { id: 60, codigo: 'MP-TEC-0024', saldo: D(100), unidade: 'm' }];
    await chamar(svc, tx, new Map([[115, D(10)], [60, D(4)]]), mats);
    expect(movs.map((m) => m.materialId).sort((a, b) => a - b)).toEqual([60, 115]);
    expect(movs.find((m) => m.materialId === 60)!.saldoApos.toFixed(3)).toBe('96.000');
  });

  it('sem consumo nenhum não grava movimento', async () => {
    const { svc, tx, movs } = servico();
    await chamar(svc, tx, new Map(), MATS);
    expect(movs).toHaveLength(0);
  });

  it('material fora da lista não quebra — grava com unidade padrão', async () => {
    const { svc, tx, movs } = servico();
    await chamar(svc, tx, new Map([[999, D(5)]]), MATS);
    expect(movs).toHaveLength(1);
    expect(movs[0].unidade).toBe('un');
    expect(movs[0].saldoApos.toFixed(3)).toBe('-5.000');
  });

  it('falha ao gravar o histórico NÃO derruba a geração da OP', async () => {
    const { svc } = servico();
    const txRuim = { movimentoMaterial: { createMany: () => Promise.reject(new Error('banco fora')) } };
    await expect(chamar(svc, txRuim, new Map([[115, D(1250)]]), MATS)).resolves.toBeUndefined();
  });
});
