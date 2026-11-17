/**
 * FICHA TÉCNICA DO PRODUTO — o pé da página não pode encavalar.
 *
 * A ficha do cliente é UMA folha e termina sempre igual: bloco de aprovação
 * (com os quadrinhos e as linhas de Nome/Assinatura/Data) e rodapé. O bloco
 * era posicionado com `Math.min(y, H - 130)`: quando as OBSERVAÇÕES cresciam,
 * o bloco SUBIA e era desenhado POR CIMA do texto. Na ficha do PRD-CAM-0120
 * (Delphos, 16/11/2026) a assinatura saiu em cima das observações, e as duas
 * coisas ficaram ilegíveis — numa folha que vai para o cliente assinar.
 *
 * Agora a âncora do bloco é fixa e quem cede é o texto, que é cortado com
 * reticências e avisa que foi cortado. Este teste mede as coordenadas de cada
 * texto desenhado e prova que nada do conteúdo invade a faixa reservada.
 */
import { DocumentosService } from './documentos.service';

/**
 * Cada `doc.text` desenhado: onde COMEÇOU e onde TERMINOU.
 *
 * O `fim` é o que importa, e foi a lição deste teste: um parágrafo de 60
 * linhas é UMA chamada `doc.text` que começa no alto da página e flui para
 * baixo. Olhando só o início, o texto que invadia a assinatura parecia estar
 * no lugar certo — o teste passava com o código defeituoso.
 */
type Marca = { texto: string; y: number; fim: number };
const marcas: Marca[] = [];

jest.mock('./pdf.renderer', () => {
  const real = jest.requireActual('./pdf.renderer');
  const instrumentar = (doc: { text: (...a: unknown[]) => unknown; y: number }) => {
    const original = doc.text.bind(doc);
    doc.text = (t: unknown, ...resto: unknown[]) => {
      // A posição vem no 3º argumento (x, y) quando explícita; senão é o fluxo.
      const y = typeof resto[1] === 'number' ? (resto[1] as number) : doc.y;
      const r = original(t as never, ...(resto as []));
      marcas.push({ texto: String(t), y, fim: Math.max(y, doc.y) });
      return r;
    };
    return doc;
  };
  return {
    ...real,
    novoDocumento: (titulo: string, numero: string) => instrumentar(real.novoDocumento(titulo, numero)),
    novoDocumentoLimpo: (titulo: string, numero: string) => instrumentar(real.novoDocumentoLimpo(titulo, numero)),
  };
});

beforeEach(() => { marcas.length = 0; });

/** A4 em pontos — é o tamanho que `novoDocumentoLimpo` usa. */
const H = 841.89;
const Y_APROVACAO = H - 130;

const OBS_CURTA = 'Camisa social feminina de manga longa.';
/** Observação de peça real é longa: logo, cores, manual da marca, acabamentos. */
const OBS_LONGA = Array.from({ length: 60 }, (_, i) =>
  `Linha ${i + 1}: aplicação da logomarca conforme manual da marca, cores verde, cinza e preto, medida 7,0 x 7,0 cm centralizada no bolso do peito.`).join('\n');

function servico(observacoes: string, medidas: Array<Record<string, unknown>> = []) {
  const prisma = {
    produto: {
      findUnique: () => Promise.resolve({
        id: 247, empresaId: 1, codigo: 'PRD-CAM-0120', descricao: 'CAMISA SOCIAL M.L FEM.',
        cor: 'BRANCA', grade: 'PP, P, M, G, GG, G1, G2, G3, G4, G5, G6, G7, G8',
        tecido: 'ROVASOL 70% ALGODAO / 30% POLIESTER', composicao: '70% ALGODAO / 30% POLIESTER',
        modelagem: 'INTS0037 - CAMISA SOCIAL FEM ML', marca: null, linha: null, grupo: null,
        projeto: 'CAMISA SOCIAL M.L FEM.', revisao: null, detalhes: null,
        especificacoes: null, observacoes, fotoModelo: null, mapaDtf: null,
        aplicacoes: null, clienteId: 7, referencia: null, medidas,
      }),
    },
    cliente: { findUnique: () => Promise.resolve({ nome: 'DELPHOS SERVICOS DE VIGILANCIA E SEGURANCA LTDA', fantasia: null }) },
  };
  const arquivos = { dataUri: () => Promise.resolve(null) };
  const svc = new DocumentosService(arquivos as never, prisma as never, null as never);
  return svc as unknown as { pdfFichaTecnica: (id: number, emp: number, num: string) => Promise<{ end: () => void }> };
}

/** Encerra o doc sem escrever em lugar nenhum — só queremos as coordenadas. */
async function desenhar(observacoes: string, medidas: Array<Record<string, unknown>> = []) {
  const doc = await servico(observacoes, medidas).pdfFichaTecnica(247, 1, 'FT-TESTE');
  doc.end();
}

const achar = (parte: string) => marcas.filter((m) => m.texto.includes(parte));

describe('ficha técnica: o pé da página', () => {
  it('o bloco de aprovação fica SEMPRE no mesmo lugar, texto curto ou longo', async () => {
    await desenhar(OBS_CURTA);
    const curto = achar('APROVAÇÃO DO CLIENTE')[0];
    marcas.length = 0;
    await desenhar(OBS_LONGA);
    const longo = achar('APROVAÇÃO DO CLIENTE')[0];
    expect(curto).toBeDefined();
    expect(longo).toBeDefined();
    expect(longo.y).toBeCloseTo(curto.y, 1);
    expect(longo.y).toBeCloseTo(Y_APROVACAO + 5.5, 1);
  });

  /**
   * O DEFEITO ORIGINAL, em uma asserção.
   *
   * Mede o FIM do parágrafo, não o começo: é para baixo que ele cresce, e era
   * para baixo que ele passava por cima da assinatura.
   */
  it('OBSERVAÇÃO LONGA não é desenhada em cima da aprovação', async () => {
    await desenhar(OBS_LONGA);
    const obs = achar('Linha 1:');
    expect(obs.length).toBeGreaterThan(0);
    for (const m of obs) {
      expect(m.y).toBeLessThan(Y_APROVACAO);
      expect(m.fim).toBeLessThanOrEqual(Y_APROVACAO);
    }
  });

  it('nenhum conteúdo da ficha termina dentro da faixa da assinatura', async () => {
    await desenhar(OBS_LONGA);
    const doPe = ['APROVAÇÃO DO CLIENTE', 'Aprovado', 'Reprovado', 'Nome', 'Assinatura', 'Data',
      'hcqualitycorp', '97620-8741', 'contato@', 'Q U A L I D A D E'];
    const conteudo = marcas.filter((m) => !doPe.some((p) => m.texto.includes(p)));
    for (const m of conteudo) expect(m.fim).toBeLessThanOrEqual(Y_APROVACAO);
  });

  it('quando corta, a ficha AVISA que cortou', async () => {
    await desenhar(OBS_LONGA);
    expect(achar('Observações completas na ficha de produção')).toHaveLength(1);
  });

  it('observação curta NÃO ganha o aviso de corte', async () => {
    await desenhar(OBS_CURTA);
    expect(achar('Observações completas na ficha de produção')).toHaveLength(0);
  });

  it('as linhas de assinatura ficam abaixo da aprovação e acima do rodapé', async () => {
    await desenhar(OBS_LONGA);
    const ap = achar('APROVAÇÃO DO CLIENTE')[0];
    for (const r of ['Nome', 'Assinatura', 'Data']) {
      const l = achar(r)[0];
      expect(l).toBeDefined();
      expect(l.y).toBeGreaterThan(ap.y);
      expect(l.y).toBeLessThan(H - 52); // o rodapé preto começa aqui
    }
  });

  /**
   * Muita medida também empurrava a página. A tabela é cortada antes do pé, e
   * diz quantas ficaram de fora.
   */
  it('tabela de medidas longa não invade a faixa reservada', async () => {
    const medidas = Array.from({ length: 40 }, (_, i) => ({
      descricao: `MEDIDA ${i + 1}`, tolerancia: '1,0', ordem: i,
      valores: { PP: '40', P: '42', M: '44' },
    }));
    await desenhar(OBS_CURTA, medidas);
    const linhas = achar('MEDIDA ');
    expect(linhas.length).toBeGreaterThan(0);
    for (const m of linhas) expect(m.y).toBeLessThan(Y_APROVACAO);
    expect(achar('na ficha de produção').length).toBeGreaterThan(0);
  });
});
