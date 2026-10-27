/**
 * Bipar a ETIQUETA MASTER fecha a conferência.
 *
 * Quem está na bancada tem UM leitor e UM campo: bipa as peças e, no fim, a
 * etiqueta master da expedição. A própria mensagem de conclusão manda fazer
 * isso ("Libere a etiqueta master e despache") — mas o campo respondia
 * 'Etiqueta "EXP0155" não reconhecida', e a pessoa tinha de adivinhar que o
 * caminho era um botão no rodapé do modal. Caso real: EXP-0155, 63/63
 * conferidas, três tentativas seguidas de bipar a master.
 */
import { ExpedicoesService } from './expedicoes.service';

function servico(exp: Record<string, unknown>) {
  const estado = { id: 181, numero: 'EXP-0155', clienteId: 9, pecas: 63, pecasConferidas: 63,
    conferenciaStatus: 'conferindo', conferidos: [], caixas: [], itens: [], ...exp };
  const gravado: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: () => Promise.resolve([{ id: estado.id }]),
    expedicao: {
      findUnique: () => Promise.resolve(estado),
      update: ({ data }: { data: Record<string, unknown> }) => { gravado.push(data); Object.assign(estado, data); return Promise.resolve(estado); },
    },
    cliente: { findUnique: () => Promise.resolve({ empresaId: 1 }) },
    unidadeEstoque: { findFirst: () => Promise.resolve(null) },
    kit: { findUnique: () => Promise.resolve(null) },
  };
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => Promise.resolve(fn(tx)) };
  return { svc: new ExpedicoesService(prisma as never, {} as never, {} as never), gravado, estado };
}

const bipar = (svc: ExpedicoesService, codigo: string) => svc.conferir(181, 1, codigo, 'admin');

describe('etiqueta master na conferência', () => {
  it('conferência completa: a master FECHA e manda despachar', async () => {
    const { svc, gravado } = servico({});
    const r = await bipar(svc, 'EXP0155') as { status: string; completou: boolean; mensagem: string };
    expect(r.status).toBe('conferida');
    expect(r.completou).toBe(true);
    expect(r.mensagem).toMatch(/canal de envio/i);
    expect(gravado[0]).toMatchObject({ conferenciaStatus: 'conferida', conferidoPor: 'admin' });
  });

  it('aceita a master com e sem hífen — é o mesmo papel', async () => {
    for (const cod of ['EXP0155', 'EXP-0155', 'exp0155']) {
      const { svc } = servico({});
      const r = await bipar(svc, cod) as { status: string };
      expect(r.status).toBe('conferida');
    }
  });

  /** A master não pode virar atalho para pular a bipagem das peças. */
  it('conferência incompleta: RECUSA e diz quanto falta', async () => {
    const { svc, gravado } = servico({ pecasConferidas: 52 });
    await expect(bipar(svc, 'EXP0155')).rejects.toThrow(/faltam 11 peça/i);
    expect(gravado).toHaveLength(0);
  });

  it('já conferida: a master não quebra nem regrava', async () => {
    const { svc, gravado } = servico({ conferenciaStatus: 'conferida' });
    const r = await bipar(svc, 'EXP0155') as { status: string };
    expect(r.status).toBe('conferida');
    expect(gravado).toHaveLength(0);
  });

  it('já despachada continua barrada', async () => {
    const { svc } = servico({ conferenciaStatus: 'despachado' });
    await expect(bipar(svc, 'EXP0155')).rejects.toThrow(/já despachada/i);
  });

  /** A master não conta como peça: 63/63 continua 63/63. */
  it('a master não soma peça nem entra na lista de conferidos', async () => {
    const { svc, estado } = servico({});
    await bipar(svc, 'EXP0155');
    expect(estado.pecasConferidas).toBe(63);
    expect(estado.conferidos).toEqual([]);
  });

  it('etiqueta de OUTRA expedição não fecha esta', async () => {
    const { svc } = servico({});
    await expect(bipar(svc, 'EXP0146')).rejects.toThrow(/não reconhecida/i);
  });

  it('código qualquer continua recusado com a mensagem de sempre', async () => {
    const { svc } = servico({});
    await expect(bipar(svc, 'UN-20261027-999999')).rejects.toThrow(/não reconhecida/i);
  });
});
