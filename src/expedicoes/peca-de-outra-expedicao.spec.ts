/**
 * Peça bipada que é de OUTRA expedição aberta.
 *
 * EXP-0119 (PV169) e EXP-0141 (PV168) sao do MESMO cliente e estavam em
 * conferencia ao mesmo tempo. Bipando um "JALECO MÉDICO M.L · G1" — que estava
 * separado para a EXP-0141 — a resposta era só "não faz parte deste pedido.
 * Não bipe peças de fora", sem dizer de onde a peça era. Com duas expedições do
 * mesmo cliente na tela, pegar o fardo errado é questão de tempo; achar o dono
 * da peça é que era trabalho.
 */
import { ExpedicoesService } from './expedicoes.service';

type Exp = { id: number; numero: string; pedidoId: number | null; conferenciaStatus?: string; itens?: Array<{ produtoId: number | null }> };

const EXPS: Exp[] = [
  { id: 119, numero: 'EXP-0119', pedidoId: 233, conferenciaStatus: 'conferindo', itens: [{ produtoId: 156 }] },
  { id: 141, numero: 'EXP-0141', pedidoId: 230, conferenciaStatus: 'conferindo', itens: [{ produtoId: 127 }, { produtoId: 179 }] },
  { id: 100, numero: 'EXP-0100', pedidoId: 200, conferenciaStatus: 'despachado', itens: [{ produtoId: 127 }] },
];
const PEDIDOS: Record<number, string> = { 233: 'PV169', 230: 'PV168', 200: 'PV150' };

function tx() {
  return {
    expedicao: {
      findUnique: ({ where }: { where: { id: number } }) => Promise.resolve(EXPS.find((e) => e.id === where.id) ?? null),
      findFirst: ({ where }: { where: { pedidoId: number; id: { not: number } } }) =>
        Promise.resolve(EXPS.find((e) => e.pedidoId === where.pedidoId && e.id !== where.id.not && e.conferenciaStatus !== 'despachado') ?? null),
      findMany: ({ where }: { where: { id: { not: number }; conferenciaStatus: { in: string[] } } }) =>
        Promise.resolve(EXPS.filter((e) => e.id !== where.id.not && where.conferenciaStatus.in.includes(e.conferenciaStatus!))),
    },
    pedido: {
      findUnique: ({ where }: { where: { id: number } }) => Promise.resolve(PEDIDOS[where.id] ? { numero: PEDIDOS[where.id] } : null),
    },
  };
}

const achar = (un: { produtoId: number | null; pedidoId: number | null; expedicaoId: number | null }) =>
  (new ExpedicoesService({} as never, {} as never) as unknown as {
    expedicaoDaPeca: (tx: unknown, un: unknown, atual: number) => Promise<string | null>;
  }).expedicaoDaPeca(tx(), un, 119);

describe('de qual expedição é a peça bipada por engano', () => {
  it('acha pelo vínculo direto da etiqueta com a expedição', async () => {
    await expect(achar({ produtoId: 127, pedidoId: null, expedicaoId: 141 })).resolves.toBe('EXP-0141 · PV168');
  });

  it('acha pelo pedido ao qual a peça está reservada', async () => {
    await expect(achar({ produtoId: 127, pedidoId: 230, expedicaoId: null })).resolves.toBe('EXP-0141 · PV168');
  });

  it('sem vínculo nenhum, acha pela expedição aberta que espera o produto', async () => {
    // O caso real: as 30 peças sem pedidoId, mas do produto que a EXP-0141 pede.
    await expect(achar({ produtoId: 127, pedidoId: null, expedicaoId: null })).resolves.toBe('EXP-0141 · PV168');
  });

  it('ignora expedição já despachada — não adianta mandar o operador para lá', async () => {
    await expect(achar({ produtoId: 999, pedidoId: 200, expedicaoId: null })).resolves.toBeNull();
  });

  it('produto que ninguém espera devolve null (a mensagem fica genérica)', async () => {
    await expect(achar({ produtoId: 999, pedidoId: null, expedicaoId: null })).resolves.toBeNull();
  });

  it('não aponta para a própria expedição que está sendo conferida', async () => {
    await expect(achar({ produtoId: 156, pedidoId: 233, expedicaoId: 119 })).resolves.toBeNull();
  });
});
