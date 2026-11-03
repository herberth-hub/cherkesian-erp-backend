/**
 * Quando o lote inteiro é recusado, a tela tem de dizer POR QUÊ.
 *
 * O Herberth bipou 152 etiquetas e levou um "Nenhuma etiqueta pôde ser endereçada
 * (despachadas ou inexistentes)". As duas causas são conversas diferentes: peça
 * despachada SAIU do armazém (voltou? precisa de entrada nova?), código que o
 * banco não acha quer dizer que a tela está velha. Juntar as duas numa frase só
 * deixava o operador sem o próximo passo — e 152 bipagens no lixo.
 */
import { EstoqueService } from './estoque.service';

const UN = (codigo: string, status: string) => ({
  codigo, status, empresaId: 1, descricao: 'CALCA EXTRA DE LOJA', cor: 'PRETO', tamanho: '42',
  coluna: null, andar: null, caixaMaster: null, comodatoClienteId: null,
});

function servico(existentes: Array<ReturnType<typeof UN>>) {
  const prisma = {
    unidadeEstoque: {
      findMany: ({ where }: { where: { codigo: { in: string[] } } }) =>
        Promise.resolve(existentes.filter((u) => where.codigo.in.includes(u.codigo))),
      updateMany: ({ where }: { where: { codigo: { in: string[] } } }) =>
        Promise.resolve({ count: where.codigo.in.length }),
    },
    log: { create: () => Promise.resolve(null) },
  };
  return new EstoqueService(prisma as never);
}

const enderecar = (svc: EstoqueService, codigos: string[]) =>
  svc.enderecarVarias({ codigos, coluna: 'A', andar: '2' }, 1, 'admin');

/** A mensagem da recusa — o que o operador lê na tela. */
const recusa = async (svc: EstoqueService, codigos: string[]): Promise<string> => {
  try { await enderecar(svc, codigos); } catch (e) { return (e as Error).message; }
  throw new Error('esperava recusa, e o lote passou');
};

describe('recusa do endereçamento em lote', () => {
  it('todas despachadas: diz que saíram do armazém e o que fazer', async () => {
    const uns = ['UN-1', 'UN-2', 'UN-3'].map((c) => UN(c, 'despachado'));
    await expect(enderecar(servico(uns), uns.map((u) => u.codigo)))
      .rejects.toThrow(/3 já saíram do armazém.*dê entrada de novo/s);
  });

  it('todas sumidas da lista: manda atualizar a tela', async () => {
    await expect(enderecar(servico([]), ['UN-7', 'UN-8']))
      .rejects.toThrow(/2 não estão mais no estoque.*atualize a tela/s);
  });

  /** O lote misto tem de contar as duas causas, não escolher uma. */
  it('metade despachada, metade sumida: nomeia as duas com os números', async () => {
    const svc = servico([UN('UN-1', 'despachado'), UN('UN-2', 'despachado')]);
    const msg = await recusa(svc, ['UN-1', 'UN-2', 'UN-9']);
    expect(msg).toMatch(/2 já saíram do armazém/);
    expect(msg).toMatch(/1 não estão mais no estoque/);
  });

  /** A frase antiga não pode voltar: ela é justamente o que não ajudava. */
  it('não volta a dizer "despachadas ou inexistentes"', async () => {
    expect(await recusa(servico([]), ['UN-7'])).not.toMatch(/despachadas ou inexistentes/);
  });

  it('havendo UMA que presta, o lote passa e a despachada fica de fora', async () => {
    const svc = servico([UN('UN-1', 'despachado'), UN('UN-2', 'em_estoque')]);
    const r = await enderecar(svc, ['UN-1', 'UN-2']);
    expect(r.ignoradas.despachadas).toEqual(['UN-1']);
  });
});
