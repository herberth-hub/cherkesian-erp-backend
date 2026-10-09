/**
 * Entrega de venda futura: CFOP e referência à nota que faturou.
 *
 * A mercadoria já foi vendida e faturada na NF de entrega futura. Quando ela sai,
 * a NF de entrega NÃO é uma venda nova — e saía como 5101/6101 (venda comum), sem
 * nenhum vínculo com a nota de faturamento. Para a contabilidade do cliente a mesma
 * mercadoria aparecia vendida duas vezes.
 *
 * A contadora apontou o CFOP correto: "venda de produção do estabelecimento
 * originada de encomenda para entrega futura" — 5116 dentro do estado, 6116
 * interestadual — referenciando a NF de venda futura.
 */
import { NfeService } from './nfe.service';

type Payload = Record<string, unknown>;
const chamada = (svc: NfeService) => (svc as unknown as { montarPayload: jest.Mock }).montarPayload;

/** Expõe o que interessa de montarPayload + a pós-edição do payload em emitirNfe. */
function servico(opts: { futura?: { id: number; numero: string; serie: number; chave: string | null } | null; ufCliente?: string } = {}) {
  const svc = Object.create(NfeService.prototype) as NfeService;
  const priv = svc as unknown as Record<string, unknown>;

  // ajustarCfop é o de verdade — é ele que decide 5116 x 6116.
  const ajustar = NfeService.prototype['ajustarCfop' as keyof NfeService] as unknown as (c: string, m: boolean) => string;

  const capturado: { extra?: Record<string, unknown>; payload?: Payload } = {};
  priv.montarPayload = jest.fn(async (_f: unknown, _d: unknown, _e: unknown, _i: unknown, _s: unknown, _n: unknown, _v: unknown, _info: unknown, extra: Record<string, unknown>) => {
    capturado.extra = extra;
    const mesmaUf = (opts.ufCliente ?? 'RJ') === 'SP';
    const cfop = extra?.cfopOverride ? ajustar.call(svc, String(extra.cfopOverride), mesmaUf) : ajustar.call(svc, '5101', mesmaUf);
    const p: Payload = { items: [{ cfop }], natureza_operacao: 'Venda' };
    capturado.payload = p;
    return p;
  });
  priv.faturamentoDeVendaFutura = jest.fn(async () => ('futura' in opts ? opts.futura : { id: 9, numero: '1/000165', serie: 1, chave: 'NFe3526060996521000172550010000001651380770143' }));
  return { svc, capturado };
}

/** Reproduz o trecho de emitirNfe que monta o payload da entrega. */
async function montarEntrega(svc: NfeService, capt: { extra?: Record<string, unknown>; payload?: Payload }) {
  const priv = svc as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const futura = (await priv.faturamentoDeVendaFutura(1, null)) as { numero: string; chave: string | null } | null;
  const payload = (await priv.montarPayload(null, null, null, null, 1, 1, 1, '', {
    bonificacao: false,
    ...(futura ? { cfopOverride: '5116' } : {}),
  })) as Payload;
  if (futura && futura.chave) payload.notas_referenciadas = [{ chave_nfe: futura.chave }];
  if (futura) payload.natureza_operacao = 'Venda originada de encomenda para entrega futura';
  return { payload, futura, extra: capt.extra };
}

describe('entrega de venda futura', () => {
  it('interestadual: CFOP 6116 (o que a contabilidade apontou)', async () => {
    const { svc, capturado } = servico({ ufCliente: 'MG' });
    const { payload } = await montarEntrega(svc, capturado);
    expect((payload.items as Array<{ cfop: string }>)[0].cfop).toBe('6116');
  });

  it('dentro do estado: CFOP 5116, não 6116', async () => {
    const { svc, capturado } = servico({ ufCliente: 'SP' });
    const { payload } = await montarEntrega(svc, capturado);
    expect((payload.items as Array<{ cfop: string }>)[0].cfop).toBe('5116');
  });

  it('referencia a NF de venda futura pela CHAVE, dentro do XML', async () => {
    const { svc, capturado } = servico();
    const { payload } = await montarEntrega(svc, capturado);
    expect(payload.notas_referenciadas).toEqual([{ chave_nfe: 'NFe3526060996521000172550010000001651380770143' }]);
  });

  it('natureza da operação deixa de ser "Venda"', async () => {
    const { svc, capturado } = servico();
    const { payload } = await montarEntrega(svc, capturado);
    expect(payload.natureza_operacao).toBe('Venda originada de encomenda para entrega futura');
  });

  it('venda NORMAL (sem venda futura) continua 6101 e sem referência', async () => {
    const { svc, capturado } = servico({ futura: null, ufCliente: 'MG' });
    const { payload, extra } = await montarEntrega(svc, capturado);
    expect((payload.items as Array<{ cfop: string }>)[0].cfop).toBe('6101');
    expect(payload.notas_referenciadas).toBeUndefined();
    expect(extra?.cfopOverride).toBeUndefined();
    expect(payload.natureza_operacao).toBe('Venda');
  });

  it('venda futura ainda SEM chave (simulada/pendente): não inventa referência', async () => {
    const { svc, capturado } = servico({ futura: { id: 9, numero: '1/000165', serie: 1, chave: null } });
    const { payload } = await montarEntrega(svc, capturado);
    expect(payload.notas_referenciadas).toBeUndefined();
    // mas o CFOP da entrega futura continua valendo
    expect((payload.items as Array<{ cfop: string }>)[0].cfop).toBe('6116');
  });
});
