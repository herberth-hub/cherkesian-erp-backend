/**
 * A proposta tem de dizer QUAL empresa do grupo está vendendo.
 *
 * O grupo fatura por três CNPJs — HC Quality, Cherkesian Têxtil e Yerevan — e o
 * PDF saía com o timbre do "Grupo Cherkesian" e mais nada: o cliente recebia a
 * PV204 (Yerevan) sem saber com quem estava negociando nem de quem viria a nota.
 * Pior, os dados bancários caíam para a matriz quando a emissora não tinha os
 * seus, e o cliente pagaria num CNPJ diferente do que vai faturar.
 */
import { Prisma } from '@prisma/client';
import { DocumentosService } from './documentos.service';
import { ArquivosService } from '../arquivos/arquivos.service';

// Captura o que foi ESCRITO no PDF, sem depender do desenho.
const secoes: string[] = [];
const campos: Array<[string, string]> = [];
const blocos: string[] = [];
const assinas: Array<[string, string]> = [];
jest.mock('./pdf.renderer', () => {
  const real = jest.requireActual('./pdf.renderer');
  return {
    ...real,
    secao: (_d: unknown, t: string) => { secoes.push(t); },
    camposDuplos: (_d: unknown, pares: Array<[string, string]>) => { campos.push(...pares); },
    textoBloco: (_d: unknown, t: string) => { blocos.push(t); },
    assinaturas: (_d: unknown, e: string, dir: string) => { assinas.push([e, dir]); },
  };
});
beforeEach(() => { secoes.length = 0; campos.length = 0; blocos.length = 0; assinas.length = 0; });

const valor = (n: number) => new Prisma.Decimal(n);
const campoDe = (rotulo: string) => campos.find(([r]) => r === rotulo)?.[1];

const YEREVAN = {
  id: 5, empresaId: 1, matriz: false, nome: 'YEREVAN CONFECÇÕES', nomeFantasia: 'YEREVAN CONFECCOES',
  cnpj: '60996521000172', inscricaoEstadual: '154.196.623.118', telefone: '(15) 3223-4436',
  logradouro: 'R Biritiba Mirim', numeroEndereco: '61', complemento: null, bairro: 'Jardim California',
  municipio: 'Barueri', uf: 'SP', cep: '06409-110', logo: null,
  dadosBancarios: 'Favorecido: YEREVAN CONFECCOES — CNPJ 60.996.521/0001-72\nBanco Santander (033)',
};
const MATRIZ = {
  ...YEREVAN, id: 3, matriz: true, nome: 'HC QUALITY CORPORATE IMPORTACAO E EXPORTACAO LTDA',
  cnpj: '45704956000102', inscricaoEstadual: '206.962.302.119', telefone: '11976208741',
  dadosBancarios: 'Favorecido: HC QUALITY CORPORATE — CNPJ 45.704.956/0001-02\nBanco Santander (033)',
};
const CLIENTE = { id: 127, nome: 'CLIENTE TESTE LTDA', cnpjCpf: '11.222.333/0001-44', cidadeUf: 'São Paulo/SP',
  contato: '(11) 90000-0000', telefone: null, cep: '01000-000', logradouro: 'Av. Teste', numeroEndereco: '100', bairro: 'Centro' };

function pedidoCom(filial: Record<string, unknown> | null) {
  return {
    id: 277, numero: 'PV204', empresaId: 1, etapa: 'orcamento', clienteUnidadeId: null, clienteId: 127,
    data: new Date('2026-10-27T12:00:00Z'), criadoEm: new Date('2026-10-27T12:00:00Z'),
    ordemCompraCliente: null, formaPagamento: '30 dias', prazoEntrega: null, frete: null,
    valorTotal: valor(1000), valorFrete: valor(0), obs: null, obsComercial: null, instrucoesEntrega: null,
    cliente: CLIENTE, filial,
    itens: [{ produtoId: null, descricao: 'CAMISA SOCIAL', cor: 'BRANCO', quantidade: 10, grade: null, valorUnit: valor(100) }],
  };
}

function servico(filial: Record<string, unknown> | null) {
  const prisma = {
    pedido: { findUnique: () => Promise.resolve(pedidoCom(filial)) },
    produto: { findMany: () => Promise.resolve([]) },
    clienteUnidade: { findUnique: () => Promise.resolve(null) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
    filial: { findFirst: () => Promise.resolve(MATRIZ) },
  };
  return new DocumentosService(new ArquivosService(), prisma as never, {} as never);
}

const montar = (svc: DocumentosService, tipo = 'proposta') =>
  (svc as unknown as { montarPdf: (t: string, r: number, e: number, n: string) => Promise<unknown> })
    .montarPdf(tipo, 277, 1, 'PV204');

describe('empresa emissora na proposta', () => {
  it('nomeia a empresa do pedido — não o grupo', async () => {
    await montar(servico(YEREVAN));
    expect(secoes).toContain('Empresa emissora');
    expect(campoDe('Razão social')).toBe('YEREVAN CONFECÇÕES');
    expect(campoDe('Inscrição estadual')).toBe('154.196.623.118');
  });

  it('a seção da emissora vem ANTES da do cliente', async () => {
    await montar(servico(YEREVAN));
    expect(secoes.indexOf('Empresa emissora')).toBeLessThan(secoes.indexOf('Cliente'));
  });

  it('formata o CNPJ mesmo guardado só com dígitos', async () => {
    await montar(servico(YEREVAN));
    expect(campoDe('CNPJ')).toBe('60.996.521/0001-72');
  });

  it('formata o telefone sem máscara no cadastro', async () => {
    await montar(servico(MATRIZ));
    expect(campoDe('Telefone')).toBe('(11) 97620-8741');
  });

  it('quem assina é a empresa emissora', async () => {
    await montar(servico(YEREVAN));
    expect(assinas[0][0]).toBe('YEREVAN CONFECÇÕES');
  });

  /** O cliente paga no CNPJ que vai faturar — nunca no de outra empresa do grupo. */
  it('os dados bancários são os DA emissora, não os da matriz', async () => {
    await montar(servico(YEREVAN));
    const banco = blocos.find((b) => b.includes('Favorecido'));
    expect(banco).toContain('YEREVAN');
    expect(banco).not.toContain('HC QUALITY');
  });

  it('pedido sem filial cai na matriz, e tudo aponta para ela', async () => {
    await montar(servico(null));
    expect(campoDe('Razão social')).toBe('HC QUALITY CORPORATE IMPORTACAO E EXPORTACAO LTDA');
    expect(campoDe('CNPJ')).toBe('45.704.956/0001-02');
    expect(blocos.find((b) => b.includes('Favorecido'))).toContain('HC QUALITY');
  });

  it('o pedido de venda também nomeia a emissora', async () => {
    await montar(servico(YEREVAN), 'pedido');
    expect(campoDe('Razão social')).toBe('YEREVAN CONFECÇÕES');
    expect(assinas[0][0]).toBe('YEREVAN CONFECÇÕES');
    expect(assinas[0][1]).toMatch(/De acordo/);
  });
});
