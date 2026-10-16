/**
 * "Montar caixas" não pode apagar o que foi BIPADO.
 *
 * EXP-0137 (PV126, Vivara): 200 peças conferidas e só 198 nos volumes — 60 peças
 * "M" bipadas apareciam como 58. Causa: salvarCaixas reescrevia o array inteiro a
 * partir do formulário, jogando fora `codigos`/`viaBip` das caixas montadas por
 * bipagem e regravando `pecas` com a quantidade DIGITADA. A peça saía do estoque
 * (a conferência estava certa) mas sumia de dentro do volume, em silêncio.
 */
import { ExpedicoesService } from './expedicoes.service';

const COD = (n: number) => `UN-20261015-${String(n).padStart(6, '0')}`;

type Caixa = { numero: number; pecas: number; conteudo?: unknown[]; codigos?: string[]; viaBip?: boolean; tipo?: string };

function servico(caixasAtuais: Caixa[], pecasConferidas = 0) {
  const gravado: { caixas?: Caixa[] } = {};
  const prisma = {
    expedicao: {
      findUnique: () => Promise.resolve({ id: 161, numero: 'EXP-0137', clienteId: 9, pecasConferidas, caixas: caixasAtuais }),
      update: ({ data }: { data: { caixas: Caixa[] } }) => { gravado.caixas = data.caixas; return Promise.resolve({}); },
    },
    cliente: { findUnique: () => Promise.resolve({ id: 9, empresaId: 1 }) },
  };
  return { svc: new ExpedicoesService(prisma as never, {} as never), gravado };
}

const linha = (tam: string, qtd: number) => ({ descricao: 'CALCA MASCULINO ESCRITORIO - VIVARA', cor: 'PRETO', tamanho: tam, qtd });

describe('salvarCaixas preserva as peças bipadas', () => {
  it('mantém os códigos e a marca viaBip da caixa montada por bipagem', async () => {
    const atuais: Caixa[] = [{ numero: 1, pecas: 2, codigos: [COD(1), COD(2)], viaBip: true, tipo: 'caixa' }];
    const { svc, gravado } = servico(atuais, 2);
    await svc.salvarCaixas(161, 1, [{ conteudo: [linha('M', 2)], tipo: 'caixa' }]);
    expect(gravado.caixas![0].codigos).toEqual([COD(1), COD(2)]);
    expect(gravado.caixas![0].viaBip).toBe(true);
    expect(gravado.caixas![0].pecas).toBe(2);
  });

  it('recusa reduzir na mão um volume com peças bipadas (o caso da EXP-0137)', async () => {
    // 60 bipadas no volume, o formulário manda 58.
    const codigos = Array.from({ length: 60 }, (_, i) => COD(i + 1));
    const atuais: Caixa[] = [{ numero: 1, pecas: 60, codigos, viaBip: true, tipo: 'fardo' }];
    const { svc, gravado } = servico(atuais, 60);
    await expect(svc.salvarCaixas(161, 1, [{ conteudo: [linha('M', 58)], tipo: 'fardo' }]))
      .rejects.toThrow(/60 peça\(s\) bipada\(s\), mas foi informado 58/);
    expect(gravado.caixas).toBeUndefined(); // nada gravado
  });

  it('aceita ACRESCENTAR peça na mão a um volume bipado (peça sem etiqueta)', async () => {
    const atuais: Caixa[] = [{ numero: 1, pecas: 2, codigos: [COD(1), COD(2)], viaBip: true, tipo: 'caixa' }];
    const { svc, gravado } = servico(atuais, 2);
    await svc.salvarCaixas(161, 1, [{ conteudo: [linha('M', 3)], tipo: 'caixa' }]);
    expect(gravado.caixas![0].pecas).toBe(3);
    expect(gravado.caixas![0].codigos).toHaveLength(2);
  });

  it('caixa montada só na mão continua funcionando (sem códigos)', async () => {
    const { svc, gravado } = servico([], 0);
    const r = await svc.salvarCaixas(161, 1, [{ conteudo: [linha('G', 44)], tipo: 'fardo' }]);
    expect(gravado.caixas![0].codigos).toEqual([]);
    expect(gravado.caixas![0].viaBip).toBe(false);
    expect(r.totalPecas).toBe(44);
  });

  it('avisa quando a soma dos volumes não bate com o conferido', async () => {
    const { svc } = servico([], 200);
    const r = await svc.salvarCaixas(161, 1, [{ conteudo: [linha('G', 44)], tipo: 'fardo' }, { conteudo: [linha('GG', 96)], tipo: 'fardo' }, { conteudo: [linha('M', 58)], tipo: 'fardo' }]);
    expect(r.totalPecas).toBe(198);
    expect(r.conferidas).toBe(200);
    expect(r.divergencia).toBe(2);
    expect(r.avisoDivergencia).toMatch(/200 peça\(s\) conferida\(s\) e 198 nos volumes.*faltam 2/);
  });

  it('sem divergência não há aviso', async () => {
    const { svc } = servico([], 44);
    const r = await svc.salvarCaixas(161, 1, [{ conteudo: [linha('G', 44)], tipo: 'fardo' }]);
    expect(r.divergencia).toBe(0);
    expect(r.avisoDivergencia).toBeNull();
  });

  it('expedição sem conferência ainda não avisa nada', async () => {
    const { svc } = servico([], 0);
    const r = await svc.salvarCaixas(161, 1, [{ conteudo: [linha('G', 44)], tipo: 'fardo' }]);
    expect(r.avisoDivergencia).toBeNull();
  });

  it('esvaziar na mão um volume com peça bipada é recusado, não silenciado', async () => {
    // Antes o filtro `c.conteudo.length` descartava a caixa inteira — e com ela os
    // códigos das peças que já tinham saído do estoque.
    const atuais: Caixa[] = [{ numero: 1, pecas: 1, codigos: [COD(1)], viaBip: true, tipo: 'caixa' }];
    const { svc, gravado } = servico(atuais, 1);
    await expect(svc.salvarCaixas(161, 1, [{ conteudo: [], tipo: 'caixa' }]))
      .rejects.toThrow(/1 peça\(s\) bipada\(s\), mas foi informado 0/);
    expect(gravado.caixas).toBeUndefined();
  });

  it('limite por volume continua valendo', async () => {
    const { svc } = servico([], 0);
    await expect(svc.salvarCaixas(161, 1, [{ conteudo: [linha('M', 60)], tipo: 'caixa' }]))
      .rejects.toThrow(/limite é 50/);
    // com a exceção confirmada, passa
    const r = await svc.salvarCaixas(161, 1, [{ conteudo: [linha('M', 60)], tipo: 'caixa' }], true);
    expect(r.totalPecas).toBe(60);
  });
});
