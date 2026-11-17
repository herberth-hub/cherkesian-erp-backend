/**
 * A FOTO DA PEÇA NOS DOCUMENTOS.
 *
 * A ficha técnica do cliente desenhava só `Produto.fotoModelo`. Só que quase
 * nenhum produto preenche esse campo: quem tem imagem no cadastro é a COR, no
 * mockup de frente — e é de lá que a tela de produtos já tira a miniatura da
 * listagem (`produtos.service`: `fotoModelo ?? cores[0].mockupFrente`).
 *
 * Resultado: a FT-0021 da PRD-CAM-0085 (Sanepav) saiu SEM foto, numa folha que
 * vai para o cliente assinar, enquanto a tela mostrava a camiseta verde. O
 * `fotoModelo` dela não era nem null — era string vazia.
 *
 * Estes testes seguram o fallback: o documento usa a mesma imagem que a tela.
 */
import { DocumentosService } from './documentos.service';

type Cor = { nome: string; mockupFrente: string | null };

/** Só o que `fotoDaPeca` toca: o findMany das cores e a resolução de `arq:`. */
function servico(cores: Cor[]) {
  let consultas = 0;
  const prisma = {
    produtoCor: {
      findMany: () => { consultas += 1; return Promise.resolve(cores); },
    },
  };
  // Devolve o data URI "baixado" do bucket, para provar que a referência foi resolvida.
  const arquivos = { dataUri: (ref: string) => Promise.resolve(`data:image/jpeg;base64,BAIXADO(${ref})`) };
  const svc = new DocumentosService(arquivos as never, prisma as never, null as never);
  return {
    foto: (p: { id: number; cor?: string | null; fotoModelo?: string | null }) =>
      (svc as unknown as { fotoDaPeca: (p: unknown) => Promise<string | null> }).fotoDaPeca(p),
    consultas: () => consultas,
  };
}

const VERDE = 'data:image/png;base64,MOCKUP-VERDE';
const AZUL = 'data:image/png;base64,MOCKUP-AZUL';

describe('foto da peça nos documentos', () => {
  it('usa fotoModelo quando ele existe — e nem vai buscar cor', async () => {
    const s = servico([{ nome: 'VERDE BANDEIRA', mockupFrente: VERDE }]);
    const r = await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: 'data:image/png;base64,OFICIAL' });
    expect(r).toBe('data:image/png;base64,OFICIAL');
    expect(s.consultas()).toBe(0);
  });

  /** O DEFEITO DA FT-0021, em uma asserção. */
  it('fotoModelo VAZIO cai no mockup da cor (era aqui que a ficha saía em branco)', async () => {
    const s = servico([{ nome: 'VERDE BANDEIRA', mockupFrente: VERDE }]);
    expect(await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: '' })).toBe(VERDE);
  });

  it('fotoModelo null e fotoModelo só com espaços também caem no mockup', async () => {
    const s = servico([{ nome: 'VERDE BANDEIRA', mockupFrente: VERDE }]);
    expect(await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: null })).toBe(VERDE);
    expect(await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: '   ' })).toBe(VERDE);
  });

  it('escolhe o mockup DA COR do produto, não o primeiro da lista', async () => {
    const s = servico([
      { nome: 'AZUL MARINHO', mockupFrente: AZUL },
      { nome: 'VERDE BANDEIRA', mockupFrente: VERDE },
    ]);
    expect(await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: '' })).toBe(VERDE);
  });

  it('casa a cor sem ligar para acento, caixa ou espaço sobrando', async () => {
    const s = servico([{ nome: 'Verde Bandeira', mockupFrente: VERDE }]);
    expect(await s.foto({ id: 183, cor: '  VERDE   BANDEIRA ', fotoModelo: '' })).toBe(VERDE);
    const t = servico([{ nome: 'MARROM CAFÉ', mockupFrente: AZUL }]);
    expect(await t.foto({ id: 183, cor: 'marrom cafe', fotoModelo: '' })).toBe(AZUL);
  });

  it('cor que não casa com nenhuma: usa a primeira cadastrada em vez de sair sem foto', async () => {
    const s = servico([{ nome: 'AZUL MARINHO', mockupFrente: AZUL }]);
    expect(await s.foto({ id: 183, cor: 'LARANJA', fotoModelo: '' })).toBe(AZUL);
  });

  it('produto sem cor nenhuma cadastrada: devolve null (a moldura em branco continua)', async () => {
    const s = servico([]);
    expect(await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: '' })).toBeNull();
  });

  /**
   * Mockup que foi salvo e depois apagado fica como string VAZIA, não null —
   * o mesmo que aconteceu com o `fotoModelo`. Filtrar só por null deixaria a
   * ficha tentar desenhar nada e cair fora pelo catch, sem usar a cor seguinte.
   */
  it('cor com mockup vazio é ignorada, e a próxima com imagem é usada', async () => {
    const s = servico([
      { nome: 'VERDE BANDEIRA', mockupFrente: '' },
      { nome: 'AZUL MARINHO', mockupFrente: AZUL },
    ]);
    expect(await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: '' })).toBe(AZUL);
  });

  it('mockup guardado no bucket (arq:) é baixado antes de ir para o PDF', async () => {
    const s = servico([{ nome: 'VERDE BANDEIRA', mockupFrente: 'arq:mockups/mwkn8xqb-0a6ff5a71f06.jpg' }]);
    const r = await s.foto({ id: 183, cor: 'VERDE BANDEIRA', fotoModelo: '' });
    expect(r).toBe('data:image/jpeg;base64,BAIXADO(arq:mockups/mwkn8xqb-0a6ff5a71f06.jpg)');
  });

  it('produto inexistente não quebra o documento', async () => {
    const s = servico([{ nome: 'VERDE BANDEIRA', mockupFrente: VERDE }]);
    expect(await s.foto(null as never)).toBeNull();
  });
});
