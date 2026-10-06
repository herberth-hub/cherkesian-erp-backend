/**
 * Como cobrar a NF — decidido logo após a emissão.
 *
 * Antes o título nascia sem saber se seria boleto ou transferência, e a decisão
 * acontecia fora do sistema: ninguém sabia, olhando o ERP, se aquele título ia
 * para o banco ou se o cliente pagaria por PIX.
 */
import { BancosService } from './bancos.service';

const NOTA = { id: 10, numero: '1/000157', filialId: 5 };
const TITULOS = [
  { id: 1, valor: 100, pago: 0 },
  { id: 2, valor: 50, pago: 0 },
];

function servico(opts: { nota?: unknown; titulos?: unknown[]; conta?: unknown } = {}) {
  const marcados: Array<Record<string, unknown>> = [];
  const prisma = {
    notaFiscal: { findFirst: () => Promise.resolve('nota' in opts ? opts.nota : NOTA) },
    contaReceber: {
      findMany: () => Promise.resolve(opts.titulos ?? TITULOS),
      updateMany: ({ data }: { data: Record<string, unknown> }) => { marcados.push(data); return Promise.resolve({ count: (opts.titulos ?? TITULOS).length }); },
    },
    contaBancaria: { findFirst: () => Promise.resolve('conta' in opts ? opts.conta : { id: 2 }) },
  };
  const svc = new BancosService(prisma as never, {} as never, {} as never);
  // a geração da remessa tem caminho próprio (já testado) — aqui só verificamos o encadeamento
  (svc as unknown as { gerarRemessa: (...a: unknown[]) => Promise<unknown> }).gerarRemessa = (
    _e: unknown, _u: unknown, contaId: unknown, ids: unknown,
  ) => Promise.resolve({ id: 99, nomeArquivo: 'CB061001.REM', contaId, ids });
  return { svc, marcados };
}

describe('definir cobrança da nota', () => {
  it('transferência: marca os títulos e NÃO gera remessa', async () => {
    const { svc, marcados } = servico();
    const r = (await svc.definirCobrancaDaNota(1, 'herberth', 10, 'transferencia')) as Record<string, unknown>;
    expect(marcados).toEqual([{ formaCobranca: 'transferencia' }]);
    expect(r.remessa).toBeUndefined();
    expect(r.titulos).toBe(2);
    expect(r.valor).toBe(150);
  });

  it('boleto: marca e gera a remessa com os títulos daquela nota', async () => {
    const { svc, marcados } = servico();
    const r = (await svc.definirCobrancaDaNota(1, 'herberth', 10, 'boleto')) as Record<string, unknown>;
    expect(marcados).toEqual([{ formaCobranca: 'boleto' }]);
    const rem = r.remessa as Record<string, unknown>;
    expect(rem.ids).toEqual([1, 2]);
    expect(rem.contaId).toBe(2); // conta CNAB da filial da nota
  });

  it('respeita a conta bancária informada', async () => {
    const { svc } = servico();
    const r = (await svc.definirCobrancaDaNota(1, 'herberth', 10, 'boleto', 7)) as Record<string, unknown>;
    expect((r.remessa as Record<string, unknown>).contaId).toBe(7);
  });

  it('nota sem conta a receber: avisa que não há o que cobrar', async () => {
    const { svc } = servico({ titulos: [] });
    await expect(svc.definirCobrancaDaNota(1, 'h', 10, 'boleto')).rejects.toThrow(/não gerou conta a receber/i);
  });

  it('boleto sem conta CNAB configurada: erro explicando o que fazer', async () => {
    const { svc } = servico({ conta: null });
    await expect(svc.definirCobrancaDaNota(1, 'h', 10, 'boleto')).rejects.toThrow(/Nenhuma conta bancária com CNAB/i);
  });

  it('transferência funciona mesmo sem conta CNAB — não depende do banco', async () => {
    const { svc } = servico({ conta: null });
    await expect(svc.definirCobrancaDaNota(1, 'h', 10, 'transferencia')).resolves.toMatchObject({ forma: 'transferencia' });
  });

  it('nota inexistente', async () => {
    const { svc } = servico({ nota: null });
    await expect(svc.definirCobrancaDaNota(1, 'h', 999, 'boleto')).rejects.toThrow(/não encontrada/i);
  });
});
