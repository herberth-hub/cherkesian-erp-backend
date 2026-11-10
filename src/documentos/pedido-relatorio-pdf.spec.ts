/**
 * RELATÓRIO DO PEDIDO (PDF).
 *
 * É a resposta a "como está o PV tal?" — não o pedido assinado que vai ao
 * cliente. Por isso o que estes testes seguram é o que FALTA: item a item,
 * quanto já saiu e quanto não saiu, a situação da produção, da expedição e do
 * faturamento.
 *
 * E seguram a trava que importa: o bloco de dinheiro não sai para quem não
 * enxerga Contas a Receber. Um PDF não pode ser a porta dos fundos por onde sai
 * o que o menu esconde.
 */
import { Prisma } from '@prisma/client';
import { DocumentosService } from './documentos.service';
import { ArquivosService } from '../arquivos/arquivos.service';

const escrito: string[] = [];
/** Cada tabela desenhada, com as larguras — para medir se o texto cabe. */
const tabelas: Array<{ colunas: Array<{ titulo: string; largura: number }>; linhas: string[][] }> = [];
jest.mock('./pdf.renderer', () => {
  const real = jest.requireActual('./pdf.renderer');
  return {
    ...real,
    novoDocumento: (titulo: string, numero: string) => {
      const doc = real.novoDocumento(titulo, numero);
      const textoReal = doc.text.bind(doc);
      doc.text = (t: unknown, ...resto: unknown[]) => { escrito.push(String(t)); return textoReal(t as never, ...(resto as [])); };
      return doc;
    },
    textoBloco: (d: unknown, t: string) => { escrito.push(t); return real.textoBloco(d, t); },
    tabela: (d: unknown, c: Array<{ titulo: string; largura: number }>, linhas: string[][]) => {
      linhas.forEach((l) => escrito.push(l.join(' | ')));
      tabelas.push({ colunas: c, linhas });
      return real.tabela(d, c, linhas);
    },
    totalDestaque: (d: unknown, rot: string, val: string) => { escrito.push(`${rot} = ${val}`); return real.totalDestaque(d, rot, val); },
  };
});
beforeEach(() => { escrito.length = 0; tabelas.length = 0; });

const dec = (n: number) => new Prisma.Decimal(n);
const tem = (re: RegExp | string) => escrito.some((t) => (typeof re === 'string' ? t.includes(re) : re.test(t)));

const HOJE = new Date('2026-11-10T12:00:00Z');
const FILIAL = { id: 3, nome: 'HC QUALITY CORPORATE IMPORTACAO E EXPORTACAO LTDA', cnpj: '45704956000102', logo: null };
const CLIENTE = { id: 26, nome: 'INSTITUTO NACIONAL DE TECNOLOGIA E SAUDE', cnpjCpf: '11344038002060', cidadeUf: 'SAO PAULO/SP' };

function pedidoCom(over: Record<string, unknown> = {}) {
  return {
    id: 311, empresaId: 1, numero: 'PV227', clienteId: 26, clienteUnidadeId: null, filialId: 3,
    data: new Date('2026-11-10T12:00:00Z'), prazoEntrega: null, valorTotal: dec(15923.2),
    etapa: 'producao', formaPagamento: '28 ddl', valorFrete: dec(0), ordemCompraCliente: null,
    bonificacao: false, obs: null, obsComercial: null,
    cliente: CLIENTE, filial: FILIAL, pedidosFilhos: [],
    itens: [
      { id: 1, produtoId: 127, descricao: 'JALECO MÉDICO M.L', cor: 'BRANCO', quantidade: 85, quantidadeExpedida: 30, valorUnit: dec(69.6), grade: { PP: 25, P: 20, M: 15, G: 15, GG: 10 } },
      { id: 2, produtoId: 126, descricao: 'COLETE - POSSO AJUDAR', cor: 'VERDE AGUA CLARO', quantidade: 40, quantidadeExpedida: 40, valorUnit: dec(65.18), grade: { UNICO: 40 } },
    ],
    ops: [
      { id: 7, numero: 'OP-0101', cor: 'BRANCO', quantidade: 85, status: 'em_producao', progresso: 60, entregaPrev: new Date('2026-11-25T12:00:00Z') },
      { id: 8, numero: 'OP-0102', cor: 'VERDE AGUA CLARO', quantidade: 40, status: 'concluido', progresso: 100, entregaPrev: null },
    ],
    ...over,
  };
}

const EXPEDICAO = { id: 2, numero: 'EXP-0044', pecas: 70, nf: 'NF-000123', transportadora: 'JADLOG', status: 'Despachado', parcial: true, data: new Date('2026-11-09T12:00:00Z'), dataSaida: new Date('2026-11-09T12:00:00Z') };
const NOTA = { id: 5, numero: 'NF-000123', serie: '1', tipo: 'venda', status: 'autorizada', valor: dec(4700), emitidaEm: new Date('2026-11-09T12:00:00Z') };
const TITULO = { id: 9, vencimento: new Date('2026-12-07T12:00:00Z'), valor: dec(4700), pago: dec(1700), status: 'a_vencer' };

function servico(
  pedido: Record<string, unknown> | null,
  extras: { expedicoes?: unknown[]; notas?: unknown[]; titulos?: unknown[] } = {},
) {
  const chamadas = { contaReceber: 0 };
  const prisma = {
    pedido: { findUnique: () => Promise.resolve(pedido) },
    expedicao: { findMany: () => Promise.resolve(extras.expedicoes ?? []) },
    notaFiscal: { findMany: () => Promise.resolve(extras.notas ?? []) },
    contaReceber: { findMany: () => { chamadas.contaReceber++; return Promise.resolve(extras.titulos ?? []); } },
    clienteUnidade: { findUnique: () => Promise.resolve(null) },
    produto: { findMany: () => Promise.resolve([{ id: 127, codigo: 'PRD-JAL-0014' }, { id: 126, codigo: 'PRD-COL-0002' }]) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
  };
  return { svc: new DocumentosService(new ArquivosService(), prisma as never, {} as never), chamadas };
}

const montar = (svc: DocumentosService, acesso = 'total', id = 311) =>
  (svc as unknown as { montarPdf: (t: string, r: number, e: number, n: string, f: string | null, a: string) => Promise<unknown> })
    .montarPdf('pedido_relatorio', id, 1, 'RPV-0001', null, acesso);

describe('o que falta — o miolo do relatório', () => {
  it('cada item mostra pedido, expedido e o que falta', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem(/JALECO MÉDICO M\.L.*\| 85 \| 30 \| 55 \|/s)).toBe(true);
  });

  it('item já entregue por inteiro não inventa saldo — mostra travessão', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem(/COLETE - POSSO AJUDAR.*\| 40 \| 40 \| — \|/s)).toBe(true);
  });

  it('o item leva o código do cadastro e a grade de tamanhos', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem('PRD-JAL-0014')).toBe(true);
    expect(tem('PP 25 · P 20 · M 15 · G 15 · GG 10')).toBe(true);
  });

  it('o destaque soma as peças: quantas saíram do total', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem('Peças · 70 expedidas de 125')).toBe(true);
  });
});

describe('atraso — a informação que faz alguém agir', () => {
  it('pedido vivo com prazo vencido grita o atraso em dias', async () => {
    const venceu = new Date(Date.now() - 6 * 86400000);
    await montar(servico(pedidoCom({ prazoEntrega: venceu })).svc);
    expect(tem(/ATRASADO há 6 dia\(s\)/)).toBe(true);
  });

  it('pedido concluído não é acusado de atraso', async () => {
    const venceu = new Date(Date.now() - 30 * 86400000);
    await montar(servico(pedidoCom({ prazoEntrega: venceu, etapa: 'concluido' })).svc);
    expect(tem(/ATRASADO/)).toBe(false);
  });

  it('sem prazo combinado, não há atraso a declarar', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem(/ATRASADO/)).toBe(false);
  });
});

describe('situação no sistema', () => {
  it('resume a produção em OPs concluídas e progresso médio', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem('1/2 OP · 80%')).toBe(true);
  });

  it('pedido sem OP diz "Sem OP" em vez de 0/0', async () => {
    await montar(servico(pedidoCom({ ops: [] })).svc);
    expect(tem('Sem OP')).toBe(true);
  });

  it('OP cancelada não entra na conta da produção', async () => {
    const ops = [...pedidoCom().ops, { id: 9, numero: 'OP-0103', cor: null, quantidade: 10, status: 'cancelado', progresso: 0, entregaPrev: null }];
    await montar(servico(pedidoCom({ ops })).svc);
    expect(tem('1/2 OP · 80%')).toBe(true);
  });

  it('nada expedido aparece como "Nada saiu", não como vazio', async () => {
    const itens = pedidoCom().itens.map((i) => ({ ...i, quantidadeExpedida: 0 }));
    await montar(servico(pedidoCom({ itens })).svc);
    expect(tem('Nada saiu')).toBe(true);
  });

  it('sem nota fiscal, diz "Sem NF"', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem('Sem NF')).toBe(true);
  });

  it('com nota, mostra o número dela no lugar do "Sem NF"', async () => {
    await montar(servico(pedidoCom(), { notas: [NOTA] }).svc);
    expect(tem('NF NF-000123')).toBe(true);
    expect(tem('Sem NF')).toBe(false);
  });

  it('nota CANCELADA não conta como faturamento', async () => {
    await montar(servico(pedidoCom(), { notas: [{ ...NOTA, status: 'cancelada' }] }).svc);
    expect(tem('Sem NF')).toBe(true);
  });
});

describe('o rastro: produção, expedição e nota', () => {
  it('lista as OPs com situação legível e entrega prevista', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem(/OP-0101 \| BRANCO \| 85 \| em producao \| 60% \| 25\/11\/2026/)).toBe(true);
  });

  it('marca a remessa parcial como parcial', async () => {
    await montar(servico(pedidoCom(), { expedicoes: [EXPEDICAO] }).svc);
    expect(tem(/EXP-0044 \(parcial\) \| 09\/11\/2026 \| 70 \| NF-000123 \| JADLOG \| Despachado/)).toBe(true);
  });

  it('lista a nota fiscal com valor e situação', async () => {
    await montar(servico(pedidoCom(), { notas: [NOTA] }).svc);
    expect(tem(/NF-000123\/1 \| venda \| 09\/11\/2026 \| R\$\s*4\.700,00 \| autorizada/)).toBe(true);
  });
});

describe('dinheiro — o que o perfil não pode ver, não sai impresso', () => {
  it('quem enxerga Contas a Receber vê os títulos, com pago e saldo', async () => {
    const { svc } = servico(pedidoCom(), { titulos: [TITULO] });
    await montar(svc, 'total');
    expect(tem(/07\/12\/2026 \| R\$\s*4\.700,00 \| R\$\s*1\.700,00 \| R\$\s*3\.000,00 \| a vencer/)).toBe(true);
    expect(tem(/Recebido R\$\s*1\.700,00 · em aberto = R\$\s*3\.000,00/)).toBe(true);
  });

  it('produção imprime o mesmo relatório SEM o bloco financeiro', async () => {
    const { svc } = servico(pedidoCom(), { titulos: [TITULO] });
    await montar(svc, 'producao');
    expect(tem('JALECO MÉDICO M.L')).toBe(true);   // o relatório continua útil
    expect(tem(/07\/12\/2026 \| R\$/)).toBe(false); // mas o título não aparece
    expect(tem(/em aberto =/)).toBe(false);
  });

  it('para esse perfil o título nem chega a ser consultado no banco', async () => {
    const { svc, chamadas } = servico(pedidoCom(), { titulos: [TITULO] });
    await montar(svc, 'expedicao');
    expect(chamadas.contaReceber).toBe(0);
  });

  it('sem perfil informado, o dinheiro fica de fora (falha para o lado seguro)', async () => {
    const { svc, chamadas } = servico(pedidoCom(), { titulos: [TITULO] });
    await (svc as unknown as { montarPdf: (t: string, r: number, e: number, n: string) => Promise<unknown> })
      .montarPdf('pedido_relatorio', 311, 1, 'RPV-0001');
    expect(chamadas.contaReceber).toBe(0);
  });

  it('pedido de bonificação explica por que não há título', async () => {
    const { svc } = servico(pedidoCom({ bonificacao: true }));
    await montar(svc, 'total');
    expect(tem('BONIFICAÇÃO')).toBe(true);
  });

  it('sem título gerado, diz isso em vez de deixar a seção muda', async () => {
    await montar(servico(pedidoCom()).svc, 'total');
    expect(tem('Nenhum título gerado')).toBe(true);
  });
});

/**
 * O número quebrado em duas linhas — "R$ 3.486,0" em cima e "0" embaixo — foi
 * o primeiro defeito que apareceu ao imprimir de verdade. Em vez de olhar
 * página por página a cada mudança, o teste MEDE: nenhum valor curto (número,
 * data, dinheiro) pode ser mais largo que a coluna onde ele vai.
 */
describe('a tabela cabe na coluna', () => {
  it('nenhum número, data ou valor é quebrado em duas linhas', async () => {
    const { svc } = servico(
      // Valores propositalmente folgados: pedido na casa dos milhões e remessa
      // com transportadora de nome comprido.
      pedidoCom({
        valorTotal: dec(1234567.89),
        itens: [{ ...pedidoCom().itens[0], quantidade: 9999, quantidadeExpedida: 1234, valorUnit: dec(1234.56) }],
      }),
      { expedicoes: [EXPEDICAO], notas: [NOTA], titulos: [{ ...TITULO, valor: dec(987654.32), pago: dec(123456.78) }] },
    );
    await montar(svc, 'total');

    const PDFDocument = jest.requireActual('pdfkit');
    const regua = new PDFDocument({ size: 'A4' });
    regua.font('Helvetica').fontSize(9.5); // mesma fonte/corpo das linhas em pdf.renderer
    const curto = (t: string) => /^[—\d\s./,:%R$-]+$/.test(t) && t.length <= 20; // número, data, dinheiro
    const estouros: string[] = [];
    for (const t of tabelas) {
      for (const linha of t.linhas) {
        linha.forEach((cel, i) => {
          const col = t.colunas[i];
          if (!col || !curto(cel)) return;
          const largura = regua.widthOfString(cel);
          if (largura > col.largura - 10) estouros.push(`${col.titulo}: "${cel}" precisa de ${Math.ceil(largura)}pt e tem ${col.largura - 10}pt`);
        });
      }
    }
    expect(estouros).toEqual([]);
  });

  it('as colunas somam exatamente a largura útil da folha — sem sobra nem transbordo', async () => {
    await montar(servico(pedidoCom(), { expedicoes: [EXPEDICAO], notas: [NOTA] }).svc, 'total');
    const UTIL = 595.28 - 100; // largura do A4 menos as margens de 50pt
    expect(tabelas.length).toBeGreaterThan(2);
    for (const t of tabelas) {
      expect(t.colunas.reduce((s, c) => s + c.largura, 0)).toBeCloseTo(UTIL, 1);
    }
  });
});

describe('o papel diz o que é', () => {
  it('avisa que não é o pedido do cliente nem documento fiscal', async () => {
    await montar(servico(pedidoCom()).svc);
    expect(tem('Não é o pedido assinado pelo cliente e não tem valor fiscal')).toBe(true);
  });

  it('sai ABERTO do montador — quem fecha é o controller, depois do pipe', async () => {
    const doc = (await montar(servico(pedidoCom()).svc)) as NodeJS.ReadableStream & { end: () => void };
    const pedacos: Buffer[] = [];
    const pronto = new Promise<void>((ok, falha) => {
      doc.on('data', (c: Buffer) => pedacos.push(c));
      doc.on('end', () => ok());
      doc.on('error', falha);
    });
    doc.end();
    await pronto;
    expect(Buffer.concat(pedacos).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('escopo', () => {
  it('pedido de outra empresa não é impresso', async () => {
    await expect(montar(servico(pedidoCom({ empresaId: 2 })).svc)).rejects.toThrow(/não encontrado/i);
  });

  it('pedido inexistente não vira PDF vazio', async () => {
    await expect(montar(servico(null).svc)).rejects.toThrow(/não encontrado/i);
  });
});

export { HOJE };
