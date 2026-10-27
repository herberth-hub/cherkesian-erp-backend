/**
 * Foto do produto no catálogo: sem "Foto do modelo", vale o MOCKUP DA 1ª COR.
 *
 * A ficha técnica diz, em letras miúdas, que a imagem da frente "aparece no
 * item do pedido de venda, no catálogo e na OP desta cor". O catálogo, porém,
 * só olhava `Produto.fotoModelo` — então o PRD-CAM-0080, com frente e costas
 * do PRETO cadastradas, saía como "Sem foto" na galeria.
 */
import { ProdutosService } from './produtos.service';

const URL_ASSINADA = 'https://bucket.exemplo/assinada.jpg';
const arquivos = {
  url: () => URL_ASSINADA,
} as never;

function servico(produtos: Array<Record<string, unknown>>) {
  let selecionado: Record<string, unknown> | null = null;
  const prisma = {
    produto: {
      findMany: ({ select }: { select: Record<string, unknown> }) => {
        selecionado = select;
        return Promise.resolve(produtos);
      },
    },
  };
  return { svc: new ProdutosService(prisma as never, arquivos), select: () => selecionado };
}

const DATA_URI = 'data:image/png;base64,AAAA';

describe('foto do produto no catálogo', () => {
  it('usa a Foto do modelo quando existe', async () => {
    const { svc } = servico([{ id: 1, fotoModelo: DATA_URI, cores: [] }]);
    expect(await svc.fotos([1], 1)).toEqual({ 1: DATA_URI });
  });

  /** O caso do PRD-CAM-0080. */
  it('sem Foto do modelo, cai no mockup da 1ª cor', async () => {
    const { svc } = servico([{ id: 1, fotoModelo: null, cores: [{ mockupFrente: 'arq:mockups/x.jpg' }] }]);
    expect(await svc.fotos([1], 1)).toEqual({ 1: URL_ASSINADA });
  });

  it('a Foto do modelo tem prioridade sobre o mockup', async () => {
    const { svc } = servico([{ id: 1, fotoModelo: DATA_URI, cores: [{ mockupFrente: 'arq:mockups/x.jpg' }] }]);
    expect(await svc.fotos([1], 1)).toEqual({ 1: DATA_URI });
  });

  it('campo vazio (string) também cai no mockup', async () => {
    const { svc } = servico([{ id: 1, fotoModelo: '', cores: [{ mockupFrente: DATA_URI }] }]);
    expect(await svc.fotos([1], 1)).toEqual({ 1: DATA_URI });
  });

  it('sem foto nenhuma devolve null — a tela não fica repetindo a consulta', async () => {
    const { svc } = servico([{ id: 1, fotoModelo: null, cores: [] }]);
    expect(await svc.fotos([1], 1)).toEqual({ 1: null });
  });

  it('id pedido que não existe volta como null', async () => {
    const { svc } = servico([]);
    expect(await svc.fotos([1, 2], 1)).toEqual({ 1: null, 2: null });
  });

  /** Cor sem mockup não pode ocupar a vaga da que tem. */
  it('a consulta só traz cor COM mockup, na ordem do cadastro', async () => {
    const { svc, select } = servico([{ id: 1, fotoModelo: null, cores: [] }]);
    await svc.fotos([1], 1);
    const cores = (select() as { cores: { where: unknown; orderBy: unknown; take: number } }).cores;
    expect(cores.where).toEqual({ mockupFrente: { not: null } });
    expect(cores.orderBy).toEqual({ ordem: 'asc' });
    expect(cores.take).toBe(1);
  });

  it('ids inválidos são descartados e lote vazio não consulta', async () => {
    const { svc, select } = servico([]);
    expect(await svc.fotos([0, -3, NaN as unknown as number], 1)).toEqual({});
    expect(select()).toBeNull();
  });
});
