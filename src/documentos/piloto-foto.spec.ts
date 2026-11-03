/**
 * A ficha da piloto tem de MOSTRAR a peça.
 *
 * A foto do modelo quase nunca está na coluna: ela mora no bucket e o banco
 * guarda só a referência `arq:produtos/…`. Como a ficha da piloto desenhava a
 * coluna crua, o base64 nunca existia — a moldura "DESENHO / MODELO DA PEÇA"
 * saía em branco, sem nem o aviso de que faltava foto. Foi o que aconteceu na
 * FTP-0006 (PIL-0134, camiseta da ZAMP): a piloteira receberia a ficha de uma
 * peça preta com quatro marcas bordadas e nenhuma imagem para conferir.
 */
import { DocumentosService } from './documentos.service';
import { ArquivosService } from '../arquivos/arquivos.service';

/** PNG 1×1 de verdade — o PDFKit precisa conseguir abrir a imagem. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const REF = 'arq:produtos/mvvl1748-4e235f20c229.png';

const PILOTO = {
  id: 134, empresaId: 1, codigo: 'PIL-0134', produtoId: 266, clienteId: 142, pedidoId: null,
  clienteNome: 'ZAMP S.A.', modelagem: null, artigo: null, marca: null, cor: 'PRETO', setor: null,
  solicitacao: null, envio: null, prazoRetorno: null, tentativa: 1, status: 'em_desenvolvimento',
  liberado: false, obs: null, briefingProduto: 'CAMISETA DE MEIA MALHA', briefing: null,
};
const PRODUTO = {
  id: 266, empresaId: 1, codigo: 'PRD-CAM-0127', descricao: 'CAMISETA PREMIUM GOLA CARECA M.C',
  cor: 'PRETO', grade: null, tecido: 'MEIA MALHA', composicao: '95% ALGODAO 5% ELASTANO',
  modelagem: null, marca: null, especificacoes: null, medidas: [],
  fotoModelo: REF as string | null, fotoModelagem: null as string | null,
};

/** Devolve o data URI só para a referência conhecida — igual ao bucket real. */
function arquivos(): ArquivosService {
  const s = new ArquivosService();
  (s as unknown as { dataUri: (v: string) => Promise<string | null> }).dataUri = (v) =>
    Promise.resolve(v === REF ? PNG : null);
  return s;
}

function servico(produto: Record<string, unknown> | null = { ...PRODUTO }) {
  const prisma = {
    piloto: { findUnique: () => Promise.resolve({ ...PILOTO }) },
    produto: { findUnique: () => Promise.resolve(produto) },
    cliente: { findUnique: () => Promise.resolve({ nome: 'ZAMP S.A.' }) },
    pedido: { findUnique: () => Promise.resolve(null) },
    empresa: { findUnique: () => Promise.resolve({ logo: null }) },
  };
  return new DocumentosService(arquivos(), prisma as never, {} as never);
}

/** Gera o PDF de verdade: só os bytes provam que a imagem entrou na página. */
async function bytes(svc: DocumentosService, tipo: string): Promise<Buffer> {
  const doc = await (svc as unknown as { montarPdf: (t: string, r: number, e: number, n: string) => Promise<NodeJS.ReadableStream & { end: () => void }> })
    .montarPdf(tipo, 134, 1, 'FTP-0006');
  const pedacos: Buffer[] = [];
  return new Promise((ok, erro) => {
    doc.on('data', (b: Buffer) => pedacos.push(b));
    doc.on('end', () => ok(Buffer.concat(pedacos)));
    doc.on('error', erro);
    doc.end();
  });
}

/** O PDF só declara /Subtype /Image se alguma imagem foi mesmo embutida. */
const temImagem = (pdf: Buffer) => /\/Subtype\s*\/Image/.test(pdf.toString('latin1'));

describe('foto da peça na ficha da piloto', () => {
  it('a foto guardada no bucket aparece na FICHA TÉCNICA', async () => {
    expect(temImagem(await bytes(servico(), 'piloto_ficha'))).toBe(true);
  }, 20_000);

  it('e também na ficha de envio à piloteira', async () => {
    expect(temImagem(await bytes(servico(), 'piloto'))).toBe(true);
  }, 20_000);

  it('sem foto nenhuma, a ficha sai sem imagem — e com a moldura de aviso', async () => {
    const pdf = await bytes(servico({ ...PRODUTO, fotoModelo: null }), 'piloto_ficha');
    expect(temImagem(pdf)).toBe(false);
  }, 20_000);

  /** Faltando a foto, o desenho da modelagem já serve de referência visual. */
  it('sem foto do modelo, cai no desenho da modelagem', async () => {
    const produto = { ...PRODUTO, fotoModelo: null, fotoModelagem: REF };
    expect(temImagem(await bytes(servico(produto), 'piloto_ficha'))).toBe(true);
  }, 20_000);

  it('piloto sem produto não quebra a ficha', async () => {
    const svc = servico(null);
    (svc as unknown as { prisma: { piloto: { findUnique: () => Promise<unknown> } } }).prisma.piloto.findUnique =
      () => Promise.resolve({ ...PILOTO, produtoId: null });
    expect(temImagem(await bytes(svc, 'piloto_ficha'))).toBe(false);
  }, 20_000);
});
