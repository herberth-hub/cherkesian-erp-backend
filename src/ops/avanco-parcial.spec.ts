/**
 * Avanço de fase POR TAMANHO.
 *
 * A OP tinha uma fase só para a grade inteira. Priorizar um tamanho — adiantar o
 * GG para entregar parcial e deixar o G na costura — era impossível: o botão de
 * avanço levava tudo junto. Agora cada tamanho tem a sua posição.
 */
import { OpsService } from './ops.service';

const OP = {
  id: 516, numero: 'OP-0209', empresaId: 1, pedidoId: 55, quantidade: 26,
  gradeTamanhos: { G: 16, GG: 10 } as Record<string, number> | null, gradeCortada: { G: 16, GG: 10 } as Record<string, number> | null,
  gradeConcluida: null as Record<string, number> | null, quantidadeConcluida: 0,
  gradeFases: null as Record<string, Record<string, number>> | null,
  status: 'em_producao', setorAtual: 'Costura', progresso: 75,
};

function servico(op: Partial<typeof OP> = {}) {
  const estado = { ...OP, ...op };
  const prisma = {
    oP: {
      findUnique: () => Promise.resolve(estado),
      update: ({ data }: { data: Record<string, unknown> }) => { Object.assign(estado, data); return Promise.resolve({ ...estado }); },
    },
  };
  const svc = new OpsService(prisma as never, {} as never);
  (svc as unknown as { findOne: () => Promise<unknown> }).findOne = () => Promise.resolve(estado);
  return { svc, estado };
}

describe('avanço de fase por tamanho', () => {
  it('OP sem mapa de fases: tudo está no setor atual', async () => {
    const { svc } = servico();
    const r = await svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { GG: 10 }, 1);
    expect(r.fases).toEqual({ Costura: { G: 16 }, Acabamento: { GG: 10 } });
    expect(r.total).toBe(10);
  });

  it('prioriza o GG: o G fica para trás e a OP mostra a fase MAIS ATRASADA', async () => {
    const { svc } = servico();
    const r = await svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { GG: 10 }, 1);
    // 16 pç em Costura (75) + 10 em Acabamento (90) -> a OP ainda é "Costura"
    expect(r.setorAtual).toBe('Costura');
    expect(r.progresso).toBe(81); // (16*75 + 10*90) / 26 = 80,8
  });

  it('a grade inteira avança: a fase antiga some do mapa', async () => {
    const { svc } = servico();
    const r = await svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { G: 16, GG: 10 }, 1);
    expect(r.fases).toEqual({ Acabamento: { G: 16, GG: 10 } });
    expect(r.setorAtual).toBe('Acabamento');
    expect(r.progresso).toBe(90);
  });

  it('acumula no destino quando o tamanho já tinha peça lá', async () => {
    const { svc } = servico({ gradeFases: { Costura: { G: 16, GG: 4 }, Acabamento: { GG: 6 } } });
    const r = await svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { GG: 4 }, 1);
    expect(r.fases.Acabamento).toEqual({ GG: 10 });
    expect(r.fases.Costura).toEqual({ G: 16 });
  });

  it('não deixa avançar mais peça do que há na fase', async () => {
    // o mapa tem de somar o pendente inteiro (G16 + GG10), senão é tratado como
    // velho e refeito — ver "mapa de fases x resto do sistema" mais abaixo
    const { svc } = servico({ gradeFases: { Costura: { G: 16, GG: 4 }, Acabamento: { GG: 6 } } });
    await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { GG: 9 }, 1)).rejects.toThrow(/há 4 peça/i);
  });

  it('não deixa avançar tamanho que não está naquela fase', async () => {
    const { svc } = servico({ gradeFases: { Costura: { G: 16 }, Acabamento: { GG: 10 } } });
    await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { GG: 1 }, 1)).rejects.toThrow(/não tem peça em "Costura"/i);
  });

  it('não deixa andar para trás', async () => {
    const { svc } = servico();
    await expect(svc.avancarFaseParcial(516, 'Costura', 'Separação 1', { G: 1 }, 1)).rejects.toThrow(/depois da de origem/i);
  });

  it('pode pular fases (do Risco CAD direto para Costura)', async () => {
    const { svc } = servico({ setorAtual: 'Risco CAD', gradeFases: { 'Risco CAD': { G: 16, GG: 10 } } });
    const r = await svc.avancarFaseParcial(516, 'Risco CAD', 'Costura', { GG: 10 }, 1);
    expect(r.fases).toEqual({ 'Risco CAD': { G: 16 }, Costura: { GG: 10 } });
  });

  it('exige ao menos 1 peça', async () => {
    const { svc } = servico();
    await expect(svc.avancarFaseParcial(516, 'Costura', 'Acabamento', { GG: 0 }, 1)).rejects.toThrow(/ao menos 1 peça/i);
  });

  it('"Separação 1 · corte parcial" ainda é reconhecida como Separação 1', async () => {
    const { svc } = servico({ setorAtual: 'Separação 1 · corte parcial' });
    const r = await svc.avancarFaseParcial(516, 'Separação 1', 'Costura', { GG: 10 }, 1);
    expect(r.fases['Separação 1']).toEqual({ G: 16 });
    expect(r.fases.Costura).toEqual({ GG: 10 });
  });
});

describe('conclusão retira a peça do mapa de fases', () => {
  it('peça etiquetada sai da fase em que estava', async () => {
    const { svc } = servico({ gradeFases: { Costura: { G: 16 }, Acabamento: { GG: 10 } } });
    const r = await svc.concluirParcial(516, { GG: 6 }, 1);
    expect(r.finalizada).toBe(false);
    const fases = (r as unknown as { gradeFases: Record<string, Record<string, number>> }).gradeFases;
    expect(fases.Acabamento).toEqual({ GG: 4 });
    expect(fases.Costura).toEqual({ G: 16 });
    // a OP continua na fase da peça mais atrasada
    expect(r.setorAtual).toBe('Costura');
  });

  it('concluir tudo fecha a OP e esvazia as fases', async () => {
    const { svc } = servico({ gradeFases: { Acabamento: { G: 16, GG: 10 } } });
    const r = await svc.concluirParcial(516, { G: 16, GG: 10 }, 1);
    expect(r.finalizada).toBe(true);
    expect(r.setorAtual).toBe('Finalizado');
    const fases = (r as unknown as { gradeFases: Record<string, unknown> }).gradeFases;
    expect(Object.keys(fases)).toHaveLength(0);
  });
});

/**
 * Sincronia do mapa de fases com o resto do sistema.
 *
 * Registrar o corte, mexer na grade ou forçar o setor pela tela de ajuste mudam
 * a verdade da OP sem passar pelo avanço por tamanho. O mapa ficava velho e o
 * avanço dizia "não há peça nesta fase" numa OP cheia de peça — foi o que
 * aconteceu com a OP-0205 em produção (mapa em Corte com a grade planejada,
 * OP já em Separação 1 com só 12 peças cortadas).
 */
describe('mapa de fases x resto do sistema', () => {
  it('mapa velho que não bate com o pendente é REFEITO (caso OP-0205)', async () => {
    const { svc } = servico({
      gradeTamanhos: { G: 22, GG: 22 },
      gradeCortada: { G: 6, GG: 6 },          // cortou bem menos
      gradeFases: { Corte: { G: 22, GG: 22 } }, // mapa velho, com o planejado
      setorAtual: 'Separação 1 · corte parcial',
    });
    const r = await svc.avancarFaseParcial(516, 'Separação 1', 'Costura', { GG: 6 }, 1);
    // refez a partir do cortado e da fase real, em vez de falhar
    expect(r.fases['Separação 1']).toEqual({ G: 6 });
    expect(r.fases.Costura).toEqual({ GG: 6 });
  });

  it('registrar o corte reescreve o mapa com o que foi REALMENTE cortado', async () => {
    const { svc } = servico({ gradeCortada: null, gradeFases: { Corte: { G: 16, GG: 10 } } });
    const r = (await svc.registrarCorte(516, { G: 6, GG: 6 }, 'acabou o tecido', 1)) as unknown as
      { gradeFases: Record<string, Record<string, number>> };
    expect(r.gradeFases).toEqual({ 'Separação 1': { G: 6, GG: 6 } });
  });

  it('forçar o setor pela tela de ajuste move a OP inteira para lá', async () => {
    const { svc } = servico({ gradeFases: { 'Separação 1': { G: 16 }, Acabamento: { GG: 10 } } });
    const r = (await svc.updateStatus(516, { status: 'em_producao', setorAtual: 'Costura' } as never, 1)) as unknown as
      { gradeFases: Record<string, Record<string, number>> };
    expect(r.gradeFases).toEqual({ Costura: { G: 16, GG: 10 } });
  });

  it('mapa coerente é PRESERVADO (não refaz à toa)', async () => {
    const { svc } = servico({ gradeFases: { 'Separação 1': { G: 16 }, Acabamento: { GG: 10 } } });
    const r = await svc.avancarFaseParcial(516, 'Acabamento', 'Acabamento', {}, 1).catch(() => null);
    expect(r).toBeNull(); // destino tem de vir depois — só confirma que não explodiu
    const r2 = await svc.avancarFaseParcial(516, 'Separação 1', 'Costura', { G: 4 }, 1);
    expect(r2.fases.Acabamento).toEqual({ GG: 10 }); // o que já estava na frente não se mexeu
    expect(r2.fases['Separação 1']).toEqual({ G: 12 });
    expect(r2.fases.Costura).toEqual({ G: 4 });
  });
});
