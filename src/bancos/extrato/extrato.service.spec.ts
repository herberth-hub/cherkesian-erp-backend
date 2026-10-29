/**
 * Importação do extrato e conciliação contra os títulos.
 *
 * O que esta suíte protege, em ordem de gravidade:
 *   1. reimportar o mesmo extrato NÃO duplica dinheiro na tela;
 *   2. extrato da conta errada não entra sem alguém confirmar;
 *   3. o sistema só baixa sozinho quando a resposta é inequívoca;
 *   4. crédito não quita conta a pagar (e vice-versa).
 */
import { ExtratoService } from './extrato.service';

const OFX = (linhas: string) => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>033<ACCTID>130019372</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
${linhas}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>15320.75<DTASOF>20261031</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const TRN = (fitid: string, valor: string, data = '20261005', memo = 'TED RECEBIDA') =>
  `<STMTTRN><TRNTYPE>${valor.startsWith('-') ? 'DEBIT' : 'CREDIT'}<DTPOSTED>${data}<TRNAMT>${valor}<FITID>${fitid}<MEMO>${memo}</STMTTRN>`;

const d = (s: string) => new Date(s + 'T12:00:00');
const dec = (n: number) => ({ minus: (o: { toNumber?: () => number } | number) => dec(n - Number(o)), toFixed: (c: number) => n.toFixed(c), toNumber: () => n, valueOf: () => n });

type Cenario = {
  conta?: Record<string, unknown> | null;
  jaImportados?: string[];
  receber?: Array<Record<string, unknown>>;
  pagar?: Array<Record<string, unknown>>;
};

function servico(c: Cenario = {}) {
  const criados: Array<Record<string, unknown>> = [];
  const baixasRec: Array<unknown[]> = [];
  const baixasPag: Array<unknown[]> = [];
  const lancs: Array<Record<string, unknown>> = [];
  let seq = 1;

  const prisma = {
    contaBancaria: {
      findFirst: () => Promise.resolve(c.conta === undefined ? { id: 1, empresaId: 1, banco: 'Santander', conta: '130019372' } : c.conta),
      findMany: () => Promise.resolve([{ id: 1, banco: 'Santander', conta: '130019372', apelido: null }]),
    },
    extratoLancamento: {
      findMany: ({ where }: { where: { fitid?: { in: string[] }; importacaoId?: number } }) => {
        if (where.fitid) return Promise.resolve((c.jaImportados ?? []).map((f) => ({ fitid: f })));
        return Promise.resolve(lancs.filter((l) => l.status === 'pendente'));
      },
      findFirst: ({ where }: { where: { id: number } }) => Promise.resolve(lancs.find((l) => l.id === where.id) ?? null),
      createMany: ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) {
          criados.push(row);
          lancs.push({ ...row, id: seq++, status: 'pendente', valor: Number(row.valor as string) });
        }
        return Promise.resolve({ count: data.length });
      },
      update: ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const l = lancs.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return Promise.resolve(l);
      },
      groupBy: () => Promise.resolve([]),
    },
    extratoImportacao: {
      create: () => Promise.resolve({ id: 77 }),
      update: () => Promise.resolve({}),
      findMany: () => Promise.resolve([]),
    },
    contaReceber: {
      findMany: () => Promise.resolve((c.receber ?? []).map((t) => ({ ...t, valor: dec(Number(t.valor)), pago: dec(Number(t.pago ?? 0)) }))),
    },
    contaPagar: {
      findMany: () => Promise.resolve((c.pagar ?? []).map((t) => ({ ...t, valor: dec(Number(t.valor)), pago: dec(Number(t.pago ?? 0)) }))),
    },
    cliente: { findMany: () => Promise.resolve([{ id: 7, nome: 'SANEPAV INDUSTRIA LTDA', fantasia: 'SANEPAV' }]) },
    pedido: { findMany: () => Promise.resolve([{ id: 31, numero: 'PV147' }]) },
    fornecedor: { findMany: () => Promise.resolve([{ id: 4, nome: 'MALHARIA CENTRAL' }]) },
    log: { create: () => Promise.resolve({}) },
  };
  const receber = { baixar: (...a: unknown[]) => { baixasRec.push(a); return Promise.resolve({}); } };
  const pagar = { baixar: (...a: unknown[]) => { baixasPag.push(a); return Promise.resolve({}); } };
  return {
    svc: new ExtratoService(prisma as never, receber as never, pagar as never),
    criados, baixasRec, baixasPag, lancs,
  };
}

const REC = (id: number, valor: number, venc: string, extra: Record<string, unknown> = {}) =>
  ({ id, valor, pago: 0, vencimento: d(venc), documento: null, clienteId: 7, pedidoId: null, ...extra });

describe('importar extrato', () => {
  it('grava os lançamentos novos e devolve o placar da importação', async () => {
    const { svc, criados } = servico();
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00') + TRN('A2', '-230.50')) }, 1, 'herberth');
    expect(r.lidos).toBe(2);
    expect(r.novos).toBe(2);
    expect(r.duplicados).toBe(0);
    expect(r.saldoBanco).toBe(15320.75);
    expect(criados).toHaveLength(2);
  });

  it('REIMPORTAR o mesmo extrato não duplica dinheiro', async () => {
    const { svc, criados } = servico({ jaImportados: ['A1', 'A2'] });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00') + TRN('A2', '-230.50')) }, 1, 'h');
    expect(r.novos).toBe(0);
    expect(r.duplicados).toBe(2);
    expect(criados).toHaveLength(0);
  });

  it('importa só a parte nova de um extrato que se sobrepõe ao anterior', async () => {
    const { svc } = servico({ jaImportados: ['A1'] });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00') + TRN('A2', '-230.50')) }, 1, 'h');
    expect(r.novos).toBe(1);
    expect(r.duplicados).toBe(1);
  });

  it('recusa extrato de OUTRA conta — misturaria o dinheiro de dois CNPJs', async () => {
    const { svc } = servico({ conta: { id: 1, empresaId: 1, banco: 'Cora', conta: '99887766' } });
    await expect(svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '100.00')) }, 1, 'h'))
      .rejects.toThrow(/misturaria o dinheiro/i);
  });

  it('…mas deixa importar quando a pessoa confirma que é a mesma conta', async () => {
    const { svc } = servico({ conta: { id: 1, empresaId: 1, banco: 'Cora', conta: '99887766' } });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '100.00')), confirmarContaDiferente: true }, 1, 'h');
    expect(r.novos).toBe(1);
  });

  it('arquivo que não é OFX é recusado com mensagem de gente', async () => {
    const { svc } = servico();
    await expect(svc.importar({ contaBancariaId: 1, conteudo: 'data;valor' }, 1, 'h')).rejects.toThrow(/OFX/i);
  });

  it('conta bancária inexistente', async () => {
    const { svc } = servico({ conta: null });
    await expect(svc.importar({ contaBancariaId: 9, conteudo: OFX(TRN('A1', '1.00')) }, 1, 'h')).rejects.toThrow(/não encontrada/i);
  });
});

describe('conciliação automática na importação', () => {
  it('casa e BAIXA quando é inequívoco (valor exato, na data, candidato único)', async () => {
    const { svc, baixasRec } = servico({ receber: [REC(500, 1392, '2026-10-05')] });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00', '20261005', 'TED SANEPAV')) }, 1, 'h');
    expect(r.conciliadosAuto).toBe(1);
    expect(baixasRec[0][0]).toBe(500);
    expect(baixasRec[0][2]).toBe(1392); // baixa pelo valor que entrou no banco
  });

  it('NÃO baixa quando dois títulos iguais disputam o mesmo crédito', async () => {
    const { svc, baixasRec } = servico({ receber: [REC(500, 1392, '2026-10-05'), REC(501, 1392, '2026-10-05')] });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00', '20261005', 'TED RECEBIDA')) }, 1, 'h');
    expect(r.conciliadosAuto).toBe(0);
    expect(baixasRec).toHaveLength(0);
  });

  it('dois créditos iguais não quitam o MESMO título duas vezes', async () => {
    const { svc, baixasRec } = servico({ receber: [REC(500, 1392, '2026-10-05', { pedidoId: 31 })] });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00', '20261005', 'TED SANEPAV') + TRN('A2', '1392.00', '20261005', 'TED SANEPAV')) }, 1, 'h');
    expect(r.conciliadosAuto).toBe(1);
    expect(baixasRec).toHaveLength(1);
  });

  it('débito baixa conta a PAGAR, não a receber', async () => {
    const { svc, baixasRec, baixasPag } = servico({
      receber: [REC(500, 230.5, '2026-10-06')],
      pagar: [{ id: 800, valor: 230.5, pago: 0, vencimento: d('2026-10-06'), referencia: null, fornecedorId: 4, categoria: 'Tecido' }],
    });
    await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('B1', '-230.50', '20261006', 'PAGTO MALHARIA CENTRAL')) }, 1, 'h');
    expect(baixasPag).toHaveLength(1);
    expect(baixasPag[0][0]).toBe(800);
    expect(baixasRec).toHaveLength(0);
  });

  it('conciliarAuto:false só importa, não decide nada', async () => {
    const { svc, baixasRec } = servico({ receber: [REC(500, 1392, '2026-10-05')] });
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00', '20261005', 'TED SANEPAV')), conciliarAuto: false }, 1, 'h');
    expect(r.conciliadosAuto).toBe(0);
    expect(baixasRec).toHaveLength(0);
  });

  it('sem título que explique o lançamento, ele fica PENDENTE (não some)', async () => {
    const { svc, lancs } = servico();
    const r = await svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('T1', '-18.90', '20261006', 'TARIFA PACOTE SERVICOS')) }, 1, 'h');
    expect(r.novos).toBe(1);
    expect(r.conciliadosAuto).toBe(0);
    expect(lancs[0].status).toBe('pendente');
  });
});

describe('conciliação manual', () => {
  async function comUmLancamento(cen: Cenario, ofx: string) {
    const s = servico(cen);
    await s.svc.importar({ contaBancariaId: 1, conteudo: ofx, conciliarAuto: false }, 1, 'h');
    return s;
  }

  it('liga ao título escolhido e dá a baixa', async () => {
    const s = await comUmLancamento({ receber: [REC(500, 1392, '2026-10-05')] }, OFX(TRN('A1', '1392.00')));
    const r = await s.svc.conciliar(1, { contaReceberId: 500 }, 1, 'herberth');
    expect(r.status).toBe('conciliado');
    expect(s.baixasRec).toHaveLength(1);
    expect(s.lancs[0].conciliadoAuto).toBe(false);
  });

  it('crédito NÃO concilia com conta a pagar', async () => {
    const s = await comUmLancamento({}, OFX(TRN('A1', '1392.00')));
    await expect(s.svc.conciliar(1, { contaPagarId: 800 }, 1, 'h')).rejects.toThrow(/receber/i);
    expect(s.baixasPag).toHaveLength(0);
  });

  it('débito NÃO concilia com conta a receber', async () => {
    const s = await comUmLancamento({}, OFX(TRN('B1', '-230.50')));
    await expect(s.svc.conciliar(1, { contaReceberId: 500 }, 1, 'h')).rejects.toThrow(/pagar/i);
    expect(s.baixasRec).toHaveLength(0);
  });

  it('não concilia duas vezes o mesmo lançamento', async () => {
    const s = await comUmLancamento({ receber: [REC(500, 1392, '2026-10-05')] }, OFX(TRN('A1', '1392.00')));
    await s.svc.conciliar(1, { contaReceberId: 500 }, 1, 'h');
    await expect(s.svc.conciliar(1, { contaReceberId: 501 }, 1, 'h')).rejects.toThrow(/já está conciliado/i);
    expect(s.baixasRec).toHaveLength(1);
  });

  it('sem escolher título, não faz nada', async () => {
    const s = await comUmLancamento({}, OFX(TRN('A1', '1392.00')));
    await expect(s.svc.conciliar(1, {}, 1, 'h')).rejects.toThrow(/Escolha o título/i);
  });

  it('desconciliar solta o lançamento e AVISA que a baixa continua lançada', async () => {
    const s = await comUmLancamento({ receber: [REC(500, 1392, '2026-10-05')] }, OFX(TRN('A1', '1392.00')));
    await s.svc.conciliar(1, { contaReceberId: 500 }, 1, 'h');
    const r = await s.svc.desconciliar(1, 1, 'h');
    expect(r.status).toBe('pendente');
    expect(r.avisoBaixa).toMatch(/não foi estornada/i);
  });

  it('ignorar marca "não é título" (tarifa, IOF)', async () => {
    const s = await comUmLancamento({}, OFX(TRN('T1', '-18.90', '20261006', 'TARIFA')));
    const r = await s.svc.ignorar(1, 'tarifa do banco', 1, 'h');
    expect(r.status).toBe('ignorado');
  });

  it('lançamento conciliado não pode ser ignorado sem desfazer antes', async () => {
    const s = await comUmLancamento({ receber: [REC(500, 1392, '2026-10-05')] }, OFX(TRN('A1', '1392.00')));
    await s.svc.conciliar(1, { contaReceberId: 500 }, 1, 'h');
    await expect(s.svc.ignorar(1, 'x', 1, 'h')).rejects.toThrow(/desfaça a conciliação/i);
  });
});

describe('sugestões para a tela', () => {
  it('lista os títulos possíveis com valor, vencimento e o porquê', async () => {
    const s = servico({ receber: [REC(500, 1392, '2026-10-05', { pedidoId: 31 }), REC(501, 1392, '2026-02-01')] });
    await s.svc.importar({ contaBancariaId: 1, conteudo: OFX(TRN('A1', '1392.00', '20261005', 'TED SANEPAV PV147')), conciliarAuto: false }, 1, 'h');
    const r = await s.svc.sugestoes(1, 1);
    expect(r.sugestoes[0].tituloId).toBe(500);
    expect(r.sugestoes[0].motivos.length).toBeGreaterThan(0);
    expect(r.sugestoes[0].parte).toBe('SANEPAV');
  });
});
