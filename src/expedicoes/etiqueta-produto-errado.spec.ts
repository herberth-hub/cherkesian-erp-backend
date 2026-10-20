/**
 * Tamanho que o pedido não pede NESTE item, mas pede em OUTRO.
 *
 * EXP-0143 (Prosperar Bom Despacho): bipar a etiqueta de uma camiseta G1 dava
 * "Tamanho G1 ... acima do pedido: previsto 0, já conferido 0. Não bipe a mais."
 * — que soa como excedente. Não era: as 31 peças (30 GG + 1 G1) do
 * "CAMISETA GOLA CARECA MC" tinham sido etiquetadas no "CAMISETA GOLA CARECA",
 * produto de nome quase igual. A trava estava certa; a mensagem é que mandava
 * para o lado errado.
 */
import { ExpedicoesService } from './expedicoes.service';

type Linha = { descricao: string; cor: string | null; quantidade: number; grade: Record<string, number> };

// O snapshot real da EXP-0143, reduzido ao que importa.
const ITENS: Linha[] = [
  { descricao: 'CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', cor: 'BEGE', quantidade: 4, grade: { G: 4 } },
  { descricao: 'CAMISETA GOLA CARECA MC - PROSPERAR BOM DESPACHO', cor: 'BEGE', quantidade: 31, grade: { G1: 1, GG: 30 } },
];

function servico(itens: Linha[] = ITENS, caixas: unknown[] = []) {
  const tx = { expedicao: { findUnique: () => Promise.resolve({ itens, caixas }) } };
  const svc = new ExpedicoesService({} as never, {} as never);
  return (adicoes: Array<{ descricao: string; cor: string | null; tamanho: string; qtd: number }>) =>
    (svc as unknown as {
      travaExcedente: (tx: unknown, exp: unknown, a: unknown[], b: number | null) => Promise<void>;
    }).travaExcedente(tx, { id: 1, itens, caixas } as never, adicoes, null);
}

const bipar = (descricao: string, tamanho: string, qtd = 1) =>
  [{ descricao, cor: 'BEGE', tamanho, qtd }];

describe('etiqueta gerada no produto errado', () => {
  it('aponta o item que TEM o tamanho, em vez de falar em excedente', async () => {
    const trava = servico();
    await expect(trava(bipar('CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', 'G1')))
      .rejects.toThrow(/não tem tamanho G1 neste pedido — quem tem G1 é "CAMISETA GOLA CARECA MC/);
  });

  it('a dica também cobre o GG, que é onde estão as 30 peças', async () => {
    const trava = servico();
    await expect(trava(bipar('CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', 'GG')))
      .rejects.toThrow(/quem tem GG é "CAMISETA GOLA CARECA MC/);
  });

  it('a mensagem sugere conferir o produto da etiqueta', async () => {
    const trava = servico();
    await expect(trava(bipar('CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', 'G1')))
      .rejects.toThrow(/etiqueta provavelmente foi gerada no produto errado/);
  });

  it('tamanho que NINGUÉM pede continua como excedente comum', async () => {
    const trava = servico();
    await expect(trava(bipar('CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', 'G5')))
      .rejects.toThrow(/acima do pedido: previsto 0, já conferido 0/);
  });

  it('passar do previsto num tamanho que o item TEM segue com a mensagem de excedente', async () => {
    const trava = servico();
    await expect(trava(bipar('CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', 'G', 5)))
      .rejects.toThrow(/acima do pedido/);
  });

  it('bipagem dentro da grade passa', async () => {
    const trava = servico();
    await expect(trava(bipar('CAMISETA GOLA CARECA - PROSPERAR BOM DESPACHO', 'G', 4))).resolves.toBeUndefined();
    await expect(trava(bipar('CAMISETA GOLA CARECA MC - PROSPERAR BOM DESPACHO', 'G1', 1))).resolves.toBeUndefined();
  });
});
