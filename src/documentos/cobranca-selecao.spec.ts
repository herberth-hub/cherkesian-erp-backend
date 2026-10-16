/**
 * Demonstrativo de cobrança: sai SÓ com os títulos selecionados.
 *
 * O botão "🖨 Cobrança" mandava só o clienteId e o PDF listava tudo o que o
 * cliente tinha em aberto. Selecionando 1 título da FMA (R$ 1.392,00) saía o
 * COB-0004 com os dois (R$ 4.692,00) — e é um documento que vai para o cliente.
 */
import { DocumentosService } from './documentos.service';

// Captura as LINHAS da tabela de títulos e o total destacado — é o conteúdo que
// vai para o cliente, e era exatamente ele que vinha errado.
const linhasTabela: string[][] = [];
const totais: Array<[string, string]> = [];
// money() vem do Intl e usa espaço NÃO-separável ("R$ 1.392,00"); normaliza
// para a comparação não falhar por um caractere invisível.
jest.mock('./pdf.renderer', () => {
  const real = jest.requireActual('./pdf.renderer');
  return {
    ...real,
    tabela: (_doc: unknown, _cols: unknown, rows: string[][]) => { linhasTabela.push(...rows.map((r) => r.map((c) => String(c).replace(/ /g, ' ')))); },
    totalDestaque: (_doc: unknown, rotulo: string, valor: string) => { totais.push([rotulo, String(valor).replace(/ /g, ' ')]); },
  };
});
beforeEach(() => { linhasTabela.length = 0; totais.length = 0; });

const D = (n: number) => ({ toFixed: (k: number) => n.toFixed(k), valueOf: () => n }) as unknown as number;

const CLIENTE = { id: 9, empresaId: 1, nome: 'FMA PLÁSTICOS LTDA', cnpjCpf: '30.459.307/0001-16', cidadeUf: 'Barueri/SP', contato: '(11) 4706-3468' };
const TITULOS = [
  { id: 388, clienteId: 9, valor: D(1392), pago: D(0), vencimento: new Date('2026-10-19T12:00:00'), documento: 'EXP-0123', notaFiscalId: null, filialId: 1 },
  { id: 389, clienteId: 9, valor: D(3300), pago: D(0), vencimento: new Date('2026-10-19T12:00:00'), documento: 'EXP-0110', notaFiscalId: null, filialId: 1 },
  { id: 390, clienteId: 9, valor: D(500), pago: D(500), vencimento: new Date('2026-09-10T12:00:00'), documento: 'EXP-0100', notaFiscalId: null, filialId: 1 }, // quitado
];

function servico() {
  const prisma = {
    cliente: { findUnique: () => Promise.resolve(CLIENTE) },
    contaReceber: { findMany: () => Promise.resolve(TITULOS) },
    notaFiscal: { findMany: () => Promise.resolve([]) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
    filial: { findUnique: () => Promise.resolve(null), findFirst: () => Promise.resolve(null) },
  };
  return new DocumentosService(prisma as never, {} as never);
}

/** Chama o montador do PDF e devolve as linhas da tabela de títulos. */
const montar = (svc: DocumentosService, filtro: string | null) =>
  (svc as unknown as {
    montarPdf: (t: string, r: number, e: number, n: string, f?: string | null) => Promise<unknown>;
  }).montarPdf('cobranca', 9, 1, 'COB-0004', filtro);

const idsDoFiltro = (f: string | null) =>
  (DocumentosService as unknown as { idsDoFiltro: (s?: string | null) => number[] }).idsDoFiltro(f);

describe('recorte de títulos do demonstrativo', () => {
  it('lê os ids do filtro, ignorando lixo', () => {
    expect(idsDoFiltro('388,389')).toEqual([388, 389]);
    expect(idsDoFiltro(' 388 , 389 ')).toEqual([388, 389]);
    expect(idsDoFiltro('')).toEqual([]);
    expect(idsDoFiltro(null)).toEqual([]);
    expect(idsDoFiltro('0,-3,abc,12')).toEqual([12]);
  });

  it('1 título selecionado: o PDF lista SÓ ele e o total é o dele', async () => {
    await montar(servico(), '388');
    expect(linhasTabela.map((l) => l[0])).toEqual(['EXP-0123']);
    expect(linhasTabela.map((l) => l[2])).toEqual(['R$ 1.392,00']);
    expect(totais).toContainEqual(['Total em aberto', 'R$ 1.392,00']);
  });

  it('o outro título selecionado sozinho traz só o dele', async () => {
    await montar(servico(), '389');
    expect(linhasTabela.map((l) => l[0])).toEqual(['EXP-0110']);
    expect(totais).toContainEqual(['Total em aberto', 'R$ 3.300,00']);
  });

  it('sem seleção continua listando o cliente inteiro', async () => {
    await montar(servico(), null);
    expect(linhasTabela.map((l) => l[0]).sort()).toEqual(['EXP-0110', 'EXP-0123']);
    expect(totais).toContainEqual(['Total em aberto', 'R$ 4.692,00']);
  });

  it('título quitado nunca entra, nem com o cliente inteiro', async () => {
    await montar(servico(), null);
    expect(linhasTabela.map((l) => l[0])).not.toContain('EXP-0100');
  });

  it('título de OUTRO cliente na seleção é recusado', async () => {
    await expect(montar(servico(), '388,999')).rejects.toThrow(/999 não pertencem/);
  });

  it('seleção só com título JÁ QUITADO é recusada', async () => {
    await expect(montar(servico(), '390')).rejects.toThrow(/já estão quitados/i);
  });
});

describe('numeração do documento por seleção', () => {
  /** `criar` guarda o recorte normalizado em Documento.filtro. */
  function servicoCriar(existentes: Array<{ id: number; tipo: string; referencia: string; filtro: string | null; numero: string; urlPdf: string | null }>) {
    const criados: Array<Record<string, unknown>> = [];
    const prisma = {
      cliente: { findUnique: () => Promise.resolve(CLIENTE) },
      contaReceber: { findMany: () => Promise.resolve(TITULOS) },
      notaFiscal: { findMany: () => Promise.resolve([]) },
      empresa: { findUnique: () => Promise.resolve({ logo: null }) },
      filial: { findUnique: () => Promise.resolve(null), findFirst: () => Promise.resolve(null) },
      documento: {
        findFirst: ({ where }: { where: { tipo: string; referencia: string; filtro: string | null } }) =>
          Promise.resolve(existentes.find((d) => d.tipo === where.tipo && d.referencia === where.referencia && d.filtro === where.filtro) ?? null),
        findMany: () => Promise.resolve(existentes.map((d) => ({ numero: d.numero }))),
        create: ({ data }: { data: Record<string, unknown> }) => { criados.push(data); return Promise.resolve({ id: 77, ...data }); },
        update: () => Promise.resolve({}),
      },
    };
    const svc = new DocumentosService(prisma as never, {} as never);
    return { svc, criados };
  }
  const USER = { usuario: 'admin', empresaId: 1, acesso: 'total' } as never;

  it('normaliza o filtro: ordena, tira repetido e descarta inválido', async () => {
    const { svc, criados } = servicoCriar([]);
    await svc.criar('cobranca', 9, USER, [389, 388, 389]);
    expect(criados[0].filtro).toBe('388,389');
  });

  it('sem ids o filtro fica nulo (documento do cliente inteiro)', async () => {
    const { svc, criados } = servicoCriar([]);
    await svc.criar('cobranca', 9, USER, []);
    expect(criados[0].filtro).toBeNull();
  });

  it('a MESMA seleção reaproveita o documento — não queima número novo', async () => {
    const { svc, criados } = servicoCriar([{ id: 4, tipo: 'cobranca', referencia: '9', filtro: '388', numero: 'COB-0004', urlPdf: '/x' }]);
    const r = await svc.criar('cobranca', 9, USER, [388]);
    expect(r.numero).toBe('COB-0004');
    expect(criados).toHaveLength(0);
  });

  it('seleção DIFERENTE gera documento próprio, sem sobrescrever o anterior', async () => {
    const { svc, criados } = servicoCriar([{ id: 4, tipo: 'cobranca', referencia: '9', filtro: '388', numero: 'COB-0004', urlPdf: '/x' }]);
    const r = await svc.criar('cobranca', 9, USER, [389]);
    expect(criados).toHaveLength(1);
    expect(criados[0].filtro).toBe('389');
    expect(r.numero).not.toBe('COB-0004');
  });
});
