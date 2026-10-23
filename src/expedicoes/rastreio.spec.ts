/**
 * Código de rastreio DO TRANSPORTADOR na expedição.
 *
 * O `rastreio` que já existia é um código INTERNO, gerado pelo sistema na
 * criação da expedição — não serve para o cliente acompanhar em lugar nenhum.
 * Este é o código da transportadora, e ele quase sempre chega DEPOIS do
 * despacho: tem de poder ser informado em expedição já concluída.
 */
import { ExpedicoesService } from './expedicoes.service';
import { ArquivosService } from '../arquivos/arquivos.service';

const EXP = { id: 135, numero: 'EXP-0135', clienteId: 9, conferenciaStatus: 'despachado', transportadora: 'CORREIOS' };

function servico(exp: Partial<typeof EXP> = {}) {
  const gravado: { data?: Record<string, unknown> } = {};
  const prisma = {
    expedicao: {
      findUnique: () => Promise.resolve({ ...EXP, ...exp }),
      update: ({ data }: { data: Record<string, unknown> }) => {
        gravado.data = data;
        return Promise.resolve({
          numero: EXP.numero,
          rastreioTransp: data.rastreioTransp ?? null,
          transportadora: data.transportadora ?? { ...EXP, ...exp }.transportadora,
          rastreioEm: data.rastreioEm ?? null,
        });
      },
    },
    cliente: { findUnique: () => Promise.resolve({ id: 9, empresaId: 1 }) },
    log: { create: () => Promise.resolve({}) },
  };
  return { svc: new ExpedicoesService(prisma as never, {} as never, new ArquivosService()), gravado };
}

describe('rastreio do transportador', () => {
  it('grava o código, normalizado, com quem informou e quando', async () => {
    const { svc, gravado } = servico();
    const r = await svc.definirRastreio(135, 1, 'admin', '  aa123456789br  ');
    expect(gravado.data).toMatchObject({ rastreioTransp: 'AA123456789BR', rastreioPor: 'admin' });
    expect(gravado.data?.rastreioEm).toBeInstanceOf(Date);
    expect(r.rastreio).toBe('AA123456789BR');
    expect(r.mensagem).toMatch(/AA123456789BR gravado em EXP-0135/);
  });

  it('funciona com a expedição JÁ despachada — o código chega depois', async () => {
    const { svc } = servico({ conferenciaStatus: 'despachado' });
    await expect(svc.definirRastreio(135, 1, 'admin', 'AA123456789BR')).resolves.toBeDefined();
  });

  it('código vazio LIMPA o campo (corrige digitação errada)', async () => {
    const { svc, gravado } = servico();
    const r = await svc.definirRastreio(135, 1, 'admin', '   ');
    expect(gravado.data).toMatchObject({ rastreioTransp: null, rastreioEm: null, rastreioPor: null });
    expect(r.mensagem).toMatch(/removido/i);
  });

  it('troca a transportadora junto quando vem informada', async () => {
    const { svc, gravado } = servico();
    await svc.definirRastreio(135, 1, 'admin', 'X1', 'JADLOG');
    expect(gravado.data?.transportadora).toBe('JADLOG');
  });

  it('transportadora vazia NÃO apaga a que já estava', async () => {
    const { svc, gravado } = servico();
    await svc.definirRastreio(135, 1, 'admin', 'X1', '  ');
    expect(gravado.data?.transportadora).toBeUndefined();
  });

  it('código absurdamente longo é recusado', async () => {
    const { svc, gravado } = servico();
    await expect(svc.definirRastreio(135, 1, 'admin', 'A'.repeat(81))).rejects.toThrow(/muito longo/i);
    expect(gravado.data).toBeUndefined();
  });
});

describe('link de acompanhamento', () => {
  const url = ExpedicoesService.urlRastreio;

  it('reconhece o formato dos Correios pelo próprio código', () => {
    expect(url('AA123456789BR', null)).toMatch(/rastreamento\.correios\.com\.br.*AA123456789BR/);
  });

  it('reconhece pelos canais conhecidos', () => {
    expect(url('123', 'CORREIOS - SEDEX')).toMatch(/correios/);
    expect(url('ABC', 'JADLOG')).toMatch(/jadlog/);
  });

  it('transportadora desconhecida não ganha link — melhor nenhum que o errado', () => {
    expect(url('ZEN-9988', 'ZENATUR TRANSPORTES')).toBeNull();
    expect(url('123456', 'TRANSPORTADORA X')).toBeNull();
  });

  it('sem código não há link', () => {
    expect(url('', 'CORREIOS')).toBeNull();
    expect(url(null, null)).toBeNull();
  });
});
