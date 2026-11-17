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

function servico(observacoes: string, medidas: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) {
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
        ...extra,
      }),
    },
    cliente: {
      findUnique: () => Promise.resolve({
        nome: (extra.clienteNome as string) ?? 'DELPHOS SERVICOS DE VIGILANCIA E SEGURANCA LTDA',
        fantasia: null,
      }),
    },
    // A foto da peça cai no mockup da cor quando `fotoModelo` está vazio; aqui
    // o produto não tem cor cadastrada, então a ficha sai sem foto, como antes.
    produtoCor: { findMany: () => Promise.resolve([]) },
  };
  const arquivos = { dataUri: () => Promise.resolve(null) };
  const svc = new DocumentosService(arquivos as never, prisma as never, null as never);
  return svc as unknown as { pdfFichaTecnica: (id: number, emp: number, num: string) => Promise<{ end: () => void }> };
}

/** Encerra o doc sem escrever em lugar nenhum — só queremos as coordenadas. */
async function desenhar(observacoes: string, medidas: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) {
  const doc = await servico(observacoes, medidas, extra).pdfFichaTecnica(247, 1, 'FT-TESTE');
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

/**
 * FRASES ENCAVALADAS — a FT-0017 da PRD-CAL-0018 (Sanepav, 17/11/2026).
 *
 * A ficha posicionava cada linha num deslocamento FIXO porque acreditava que
 * `{ lineBreak: false, ellipsis: true }` cortava o texto em uma linha. Não
 * corta: no pdfkit 0.19 esse par quebra a linha do mesmo jeito. Com uma
 * descrição de peça real — "CALCA TOTAL ELASTICO C/ FX REFLETIVA C/ REFORCO NO
 * GANCHO - COLETOR" — a segunda linha era escrita POR CIMA da linha de baixo:
 * o título das especificações caiu em cima do PROJETO e a "Cor" em cima da
 * "Peça", numa folha que vai para o cliente assinar.
 *
 * Agora quem manda é a altura MEDIDA do texto. Estes testes provam que nada é
 * desenhado em cima de nada quando o cadastro traz nome comprido.
 */
const DESC_LONGA = 'CALCA TOTAL ELASTICO C/ FX REFLETIVA C/ REFORCO NO GANCHO  - COLETOR';
const ARTES_LONGAS = [
  { tipo: 'Silk', tamanho: '8x6', local: 'LOGO NO PEITO ESQUERDO SOBRE O BOLSO' },
  { tipo: 'Silk', tamanho: '15X10', local: 'LOGO CENTRALIZADO NAS COSTAS NA ALTURA DAS OMOPLATAS' },
];

/** Uma marca invade a outra quando começa antes do fim dela e na mesma faixa. */
const encavala = (a: Marca, b: Marca) => b.y < a.fim - 0.5 && b.fim > a.y + 0.5;

describe('ficha técnica: frases encavaladas', () => {
  it('a descrição longa ocupa DUAS linhas — é o caso que quebrava', async () => {
    await desenhar(OBS_CURTA, [], { descricao: DESC_LONGA, projeto: DESC_LONGA });
    const peca = achar(DESC_LONGA.slice(0, 20))[0];
    expect(peca).toBeDefined();
    expect(peca.fim - peca.y).toBeGreaterThan(12); // uma linha só teria ~10,4
  });

  it('ESPECIFICAÇÕES DA PEÇA não cai em cima do PROJETO', async () => {
    await desenhar(OBS_CURTA, [], { descricao: DESC_LONGA, projeto: DESC_LONGA });
    const projeto = achar(DESC_LONGA.slice(0, 20)).sort((a, b) => a.y - b.y)[0];
    const titulo = achar('ESPECIFICAÇÕES DA PEÇA')[0];
    expect(titulo).toBeDefined();
    expect(titulo.y).toBeGreaterThanOrEqual(projeto.fim);
  });

  it('a Cor não é escrita em cima da segunda linha da Peça', async () => {
    await desenhar(OBS_CURTA, [], { descricao: DESC_LONGA, cor: 'VERDE BANDEIRA' });
    const peca = achar(DESC_LONGA.slice(0, 20)).sort((a, b) => a.y - b.y).pop() as Marca;
    const cor = achar('VERDE BANDEIRA')[0];
    expect(cor).toBeDefined();
    expect(encavala(peca, cor)).toBe(false);
  });

  it('nenhuma linha das especificações invade a seguinte', async () => {
    await desenhar(OBS_CURTA, [], { descricao: DESC_LONGA, cor: 'VERDE BANDEIRA' });
    const rotulos = ['Peça', 'Cor', 'Modelagem', 'Tecido', 'Composição', 'Grade']
      .map((r) => achar(r)[0]).filter(Boolean).sort((a, b) => a.y - b.y);
    expect(rotulos.length).toBeGreaterThan(3);
    for (let i = 1; i < rotulos.length; i++) {
      expect(rotulos[i].y).toBeGreaterThanOrEqual(rotulos[i - 1].y + 11);
    }
  });

  it('ARTE 2 não é escrita em cima da segunda linha da ARTE 1', async () => {
    await desenhar(OBS_CURTA, [], { aplicacoes: ARTES_LONGAS });
    const a1 = achar('LOGO NO PEITO ESQUERDO')[0];
    const a2 = achar('LOGO CENTRALIZADO NAS COSTAS')[0];
    expect(a1).toBeDefined();
    expect(a2).toBeDefined();
    expect(encavala(a1, a2)).toBe(false);
  });

  /**
   * O conserto não pode mexer nas fichas que já saíam certas: com cliente e
   * projeto de uma linha, o conteúdo continua começando exatamente em 196 —
   * o mesmo valor fixo de antes.
   */
  it('cliente e projeto curtos: o conteúdo continua começando em 196', async () => {
    await desenhar(OBS_CURTA, [], { clienteNome: 'SANEPAV LTDA', projeto: 'CALCA ELASTICO' });
    const titulo = achar('ESPECIFICAÇÕES DA PEÇA')[0];
    expect(titulo.y).toBeCloseTo(196, 0);
  });

  /**
   * Razão social longa também quebra em duas linhas, e o conteúdo da esquerda
   * (a foto) precisa descer junto — senão a segunda linha do nome fica dentro
   * da imagem da peça.
   */
  it('razão social de duas linhas empurra o conteúdo para baixo', async () => {
    await desenhar(OBS_CURTA, [], { clienteNome: 'DELPHOS SERVICOS DE VIGILANCIA E SEGURANCA PATRIMONIAL LTDA' });
    const nome = achar('DELPHOS')[0];
    const titulo = achar('ESPECIFICAÇÕES DA PEÇA')[0];
    expect(nome.fim - nome.y).toBeGreaterThan(12);
    expect(titulo.y).toBeGreaterThanOrEqual(nome.fim);
  });
});
