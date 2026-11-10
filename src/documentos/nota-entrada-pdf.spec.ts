/**
 * ESPELHO DA NOTA DE ENTRADA (PDF).
 *
 * É um documento INTERNO de conferência: o Herberth abre quando quer ver algo
 * de uma entrada sem caçar o XML nem ligar para o fornecedor. Por isso ele tem
 * de contar duas coisas que o papel do fornecedor não conta — o que a nota
 * trouxe e o que o SISTEMA fez com ela (estoque, etiqueta, OC baixada, título).
 *
 * E tem de deixar claro que não é o DANFE: um papel com cara de nota fiscal
 * circulando sem valor fiscal é problema, não conveniência.
 */
import { Prisma } from '@prisma/client';
import { DocumentosService } from './documentos.service';
import { ArquivosService } from '../arquivos/arquivos.service';

// Captura tudo que foi ESCRITO no PDF, mantendo o desenho real (o documento é
// montado de verdade: se o layout estourar ou um helper faltar, o teste quebra).
const escrito: string[] = [];
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
  };
});
beforeEach(() => { escrito.length = 0; });

const dec = (n: number) => new Prisma.Decimal(n);
const tem = (re: RegExp | string) => escrito.some((t) => (typeof re === 'string' ? t.includes(re) : re.test(t)));

const FILIAL = {
  id: 3, nome: 'HC QUALITY CORPORATE IMPORTACAO E EXPORTACAO LTDA', cnpj: '45704956000102',
  logradouro: 'R Biritiba Mirim', numeroEndereco: '61', bairro: 'Jardim California',
  municipio: 'Barueri', uf: 'SP', logo: null,
};
const FORNECEDOR = {
  id: 44, empresaId: 1, nome: 'ELASTICOS TONIOLO INDUSTRIA E COMERCIO LTDA',
  cnpjCpf: '61099154000160', contato: '(11) 4000-0000', telefone: null, cidadeUf: 'São Paulo/SP',
};

function notaCom(over: Record<string, unknown> = {}) {
  return {
    id: 91, empresaId: 1, numero: '1311', serie: '0',
    chave: '35260761099154000160550000000013111000013118',
    cnpjEmitente: '61099154000160', nomeEmitente: 'ELASTICOS TONIOLO',
    emitidaEm: new Date('2026-07-20T12:00:00Z'), criadoEm: new Date('2026-07-22T12:00:00Z'),
    valor: dec(1252.8), status: 'registrada', origem: 'manual',
    lancadaEstoque: true, etiquetasGeradas: false, contaPagarId: 501, obs: null,
    fornecedor: FORNECEDOR, filial: FILIAL,
    itens: [
      { id: 1, descricao: 'ELASTICO 30MM BRANCO', codigoFornecedor: 'EL30B', ncm: '58063200', materialId: 77, produtoId: null, quantidade: dec(600), unidade: 'm', valorUnit: dec(1.788) },
      { id: 2, descricao: 'ELASTICO 50MM PRETO', codigoFornecedor: null, ncm: null, materialId: null, produtoId: null, quantidade: dec(100), unidade: 'm', valorUnit: dec(1.8) },
    ],
    ordensRecebidas: [{ numero: 'OC-0061', descricao: 'Elástico 30mm branco', valor: dec(1072.8) }],
    ...over,
  };
}

function servico(nota: Record<string, unknown> | null, conta: Record<string, unknown> | null = null) {
  const prisma = {
    notaEntrada: { findUnique: () => Promise.resolve(nota) },
    contaPagar: { findUnique: () => Promise.resolve(conta) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
  };
  return new DocumentosService(new ArquivosService(), prisma as never, {} as never);
}

const montar = (svc: DocumentosService, id = 91) =>
  (svc as unknown as { montarPdf: (t: string, r: number, e: number, n: string) => Promise<unknown> })
    .montarPdf('nota_entrada', id, 1, 'ENT-0001');

const CONTA = { vencimento: new Date('2026-08-19T12:00:00Z'), valor: dec(1252.8), status: 'a_vencer', categoria: 'Matéria-prima' };

describe('o que a nota trouxe', () => {
  it('identifica a NF, o fornecedor e o nosso CNPJ que recebeu', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('1311 / 0')).toBe(true);
    expect(tem('ELASTICOS TONIOLO INDUSTRIA E COMERCIO LTDA')).toBe(true);
    expect(tem('HC QUALITY CORPORATE IMPORTACAO E EXPORTACAO LTDA')).toBe(true);
    expect(tem('61.099.154/0001-60')).toBe(true); // CNPJ formatado, mesmo salvo só com dígitos
    expect(tem('45.704.956/0001-02')).toBe(true);
  });

  it('lista os itens com quantidade, unitário e total da linha', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('ELASTICO 30MM BRANCO')).toBe(true);
    expect(tem('600,00 m')).toBe(true);
    expect(tem(/R\$\s*1\.072,80/)).toBe(true); // 600 × 1,788
  });

  it('diz onde cada item foi amarrado no cadastro — é o que responde "virou o quê no estoque?"', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('matéria-prima #77')).toBe(true);
    expect(tem('sem vínculo no cadastro')).toBe(true);
    expect(tem('cód. no fornecedor: EL30B')).toBe(true);
  });

  it('a chave de acesso sai legível, em blocos', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('3526 0761 0991 5400 0160 5500 0000 0013 1110 0001 3118')).toBe(true);
  });

  it('nota lançada só pelo valor total não finge ter itens', async () => {
    await montar(servico(notaCom({ itens: [] }), CONTA));
    expect(tem('nenhum item foi detalhado')).toBe(true);
  });
});

describe('a conferência — o que o PDF não pode esconder', () => {
  it('aponta a diferença quando a soma dos itens não bate com o total da nota', async () => {
    // 600×1,788 + 100×1,80 = 1.252,80. Subindo o total para 1.400 aparecem R$ 147,20.
    await montar(servico(notaCom({ valor: dec(1400) }), CONTA));
    expect(tem(/diferença para o total da nota: R\$\s*147,20/)).toBe(true);
  });

  it('não inventa divergência quando a conta fecha', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem(/diferença para o total/)).toBe(false);
  });

  it('etiqueta de volume pendente aparece como PENDENTE, não como traço', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('PENDENTES')).toBe(true);
    expect(tem('Lançado')).toBe(true);
  });

  it('nota ainda não lançada no estoque diz isso em letras', async () => {
    await montar(servico(notaCom({ lancadaEstoque: false, etiquetasGeradas: false }), CONTA));
    expect(tem('NÃO lançado')).toBe(true);
  });

  it('mostra o título a pagar que a nota gerou, com vencimento', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem(/R\$\s*1\.252,80 · 19\/08\/2026/)).toBe(true);
    expect(tem(/situação a vencer/)).toBe(true);
  });

  it('sem título gerado, diz "Sem título" em vez de deixar em branco', async () => {
    await montar(servico(notaCom({ contaPagarId: null }), null));
    expect(tem('Sem título')).toBe(true);
  });

  it('lista a ordem de compra que esta entrada baixou', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('OC-0061')).toBe(true);
  });
});

describe('não é o DANFE', () => {
  it('avisa, no próprio papel, que não tem valor fiscal', async () => {
    await montar(servico(notaCom(), CONTA));
    expect(tem('Não tem valor fiscal e não substitui o DANFE/XML')).toBe(true);
  });
});

describe('escopo', () => {
  it('nota de outra empresa não é impressa', async () => {
    await expect(montar(servico(notaCom({ empresaId: 2 }), CONTA))).rejects.toThrow(/não encontrada/i);
  });

  it('nota inexistente não vira PDF vazio', async () => {
    await expect(montar(servico(null))).rejects.toThrow(/não encontrada/i);
  });
});
