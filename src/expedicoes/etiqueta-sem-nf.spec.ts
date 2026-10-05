/**
 * A etiqueta de expedição sai SEM NF-e — marcada como tal.
 *
 * O bloqueio antigo exigia nota para qualquer etiqueta, e isso tornava o
 * "despachar sem NF" impossível: a etiqueta MASTER é justamente o que se bipa
 * para despachar. Continua bloqueado quando há nota EM ANDAMENTO (pendente ou
 * rejeitada) — aí o certo é resolver a nota.
 */
import { ExpedicoesService } from './expedicoes.service';

const EXP = { id: 110, numero: 'EXP-0110', clienteId: 9, pedidoId: 125, nf: null, itens: null, loteId: null, volumes: 1 };
const CLIENTE = { id: 9, empresaId: 1, nome: 'FMA PLASTICOS LTDA', logradouro: 'R X', cidadeUf: 'Barueri/SP', cep: '06400000', cnpjCpf: '00000000000191' };

function servico(notas: Array<{ status: string }>) {
  const prisma = {
    expedicao: { findUnique: () => Promise.resolve(EXP) },
    cliente: { findUnique: () => Promise.resolve(CLIENTE) },
    notaFiscal: {
      findFirst: ({ where }: { where: { status?: { in: string[] } } }) => {
        const alvo = where.status?.in;
        const achada = alvo ? notas.find((n) => alvo.includes(n.status)) : notas[notas.length - 1];
        return Promise.resolve(achada ?? null);
      },
    },
    pedido: { findUnique: () => Promise.resolve({ id: 125, numero: 'PV125', itens: [], filial: { nome: 'HC QUALITY', cnpj: '45704956000102' } }) },
    produto: { findMany: () => Promise.resolve([]) },
  };
  return new ExpedicoesService(prisma as never);
}

describe('etiqueta de expedição sem NF-e', () => {
  it('sem nenhuma nota: gera a etiqueta e marca semNf', async () => {
    const r = (await servico([]).etiqueta(110, 1)) as Record<string, unknown>;
    expect(r.semNf).toBe(true);
    expect(r.codBip).toBe('EXP0110');
  });

  it('nota CANCELADA não impede — fiscalmente ela não existe mais', async () => {
    const r = (await servico([{ status: 'cancelada' }]).etiqueta(110, 1)) as Record<string, unknown>;
    expect(r.semNf).toBe(true);
  });

  it('nota AUTORIZADA: etiqueta normal, sem a marca', async () => {
    const r = (await servico([{ status: 'autorizada' }]).etiqueta(110, 1)) as Record<string, unknown>;
    expect(r.semNf).toBe(false);
  });

  it('nota PENDENTE continua bloqueando', async () => {
    await expect(servico([{ status: 'pendente' }]).etiqueta(110, 1)).rejects.toThrow(/pendente de autoriza/i);
  });

  it('nota REJEITADA continua bloqueando', async () => {
    await expect(servico([{ status: 'rejeitada' }]).etiqueta(110, 1)).rejects.toThrow(/rejeitada/i);
  });
});
