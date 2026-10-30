/**
 * ENTRADA de peças: o lote inteiro nasce numa escrita só.
 *
 * Era um `create` por peça. Com o Neon (pooled), 500 idas ao banco em sequência
 * estouravam o tempo — por isso havia um teto de 500 peças por entrada, e
 * fechar a OP-0054 (PV54, 1.639 peças) morria logo no G, com 524. Agora é um
 * `createMany`, e o teto passou a ser a impressão, não o banco.
 */
import { EstoqueService } from './estoque.service';

/**
 * Timeout folgado para a suíte toda: o banco virou UMA escrita, mas o código de
 * barras é desenhado peça a peça (~3,4 ms cada), então lotes grandes levam
 * segundos de CPU — e mais ainda com os workers do jest disputando o
 * processador. É o custo real da impressão, não do Postgres.
 */
jest.setTimeout(60000);

function servico(ultimoCodigoDoDia: string | null = null) {
  const lotes: Array<Array<Record<string, unknown>>> = [];
  const prisma = {
    unidadeEstoque: {
      findFirst: () => Promise.resolve(ultimoCodigoDoDia ? { codigo: ultimoCodigoDoDia } : null),
      createMany: ({ data }: { data: Array<Record<string, unknown>> }) => {
        lotes.push(data);
        return Promise.resolve({ count: data.length });
      },
      create: () => { throw new Error('nao deve criar uma a uma'); },
    },
    produto: { findUnique: () => Promise.resolve({ id: 7, empresaId: 1, codigo: 'PRD-CAM-0078', descricao: 'CAMISETA BASICA', codigosPorTamanho: null }) },
    material: { findUnique: () => Promise.resolve(null) },
  };
  return { svc: new EstoqueService(prisma as never), lotes };
}

const ENTRADA = (quantidade: number, extra: Record<string, unknown> = {}) => ({
  tipo: 'produto', produtoId: 7, descricao: 'CAMISETA BASICA', cor: 'BEGE', tamanho: 'G',
  quantidade, origem: 'producao', loteEntrada: 'OP-54', ...extra,
});

describe('entrada de peças em lote', () => {
  /**
   * Os dois testes de lote grande geram código de barras DE VERDADE, um por
   * peça — é isso que eles provam, e é isso que os faz demorar. Sob carga (o
   * jest roda as suítes em paralelo) passavam do limite padrão de 5 s e caíam
   * por tempo, não por erro. Alarme falso é o jeito mais rápido de ensinar uma
   * equipe a ignorar o CI, então o limite aqui é explícito e folgado.
   */
  const LOTE_GRANDE = 60_000;

  it('524 peças entram numa escrita só — não 524', async () => {
    const { svc, lotes } = servico();
    const r = await svc.entrada(ENTRADA(524) as never, 1, 'admin');
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toHaveLength(524);
    expect(r.total).toBe(524);
    expect(r.pecas).toHaveLength(524);
  }, LOTE_GRANDE);

  it('os códigos saem sequenciais, continuando o último do dia', async () => {
    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { svc, lotes } = servico(`UN-${hoje}-000225`);
    await svc.entrada(ENTRADA(4) as never, 1, 'admin');
    expect(lotes[0].map((l) => l.codigo)).toEqual([
      `UN-${hoje}-000226`, `UN-${hoje}-000227`, `UN-${hoje}-000228`, `UN-${hoje}-000229`,
    ]);
  });

  it('toda peça do lote carrega os mesmos dados do produto', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(ENTRADA(3) as never, 1, 'admin');
    lotes[0].forEach((l) => expect(l).toMatchObject({
      empresaId: 1, produtoId: 7, cor: 'BEGE', tamanho: 'G', loteEntrada: 'OP-54', criadoPor: 'admin',
    }));
  });

  /** Expedição = reservada ao pedido já na entrada; estoque = aguardando endereço. */
  it('destino expedição reserva as peças ao pedido', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(ENTRADA(2, { destino: 'expedicao', pedidoId: 77 }) as never, 1, 'admin');
    lotes[0].forEach((l) => expect(l).toMatchObject({ status: 'reservado', pedidoId: 77 }));
  });

  it('sem destino de expedição a peça não nasce presa a pedido nenhum', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(ENTRADA(2, { pedidoId: 77 }) as never, 1, 'admin');
    lotes[0].forEach((l) => expect(l).toMatchObject({ status: 'aguardando_endereco', pedidoId: undefined }));
  });

  it('o teto agora é 2.000 — 1.639 passa (a OP-0054 inteira)', async () => {
    const { svc, lotes } = servico();
    await svc.entrada(ENTRADA(1639) as never, 1, 'admin');
    expect(lotes[0]).toHaveLength(1639);
  }, LOTE_GRANDE);

  it('acima de 2.000 continua barrado (erro de digitação)', async () => {
    const { svc } = servico();
    await expect(svc.entrada(ENTRADA(2001) as never, 1, 'admin')).rejects.toThrow(/2\.000 unidades/);
  });

  it('quantidade zero ou negativa é recusada', async () => {
    const { svc } = servico();
    await expect(svc.entrada(ENTRADA(0) as never, 1, 'admin')).rejects.toThrow(/quantidade/i);
  });
});
