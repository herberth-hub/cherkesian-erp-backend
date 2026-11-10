/**
 * ETIQUETA 100x50 DA PEÇA-PILOTO.
 *
 * Ela vai colada na embalagem que sai para o cliente. Quem recebe tem outras
 * amostras na mesa — de outros fornecedores e de outras tentativas da mesma
 * peça —, então o que está aqui tem de identificar a peça sem abrir sistema.
 *
 * O que estes testes seguram: que a peça é nomeada mesmo sem produto cadastrado
 * (piloto avulso), que o tecido da AMOSTRA vence o tecido padrão do produto, e
 * que nada do texto cai por cima do código de barras ou do QR.
 */
import { PilotosService } from './pilotos.service';

type Piloto = Record<string, unknown>;

function servico(piloto: Piloto, extras: { produto?: Piloto | null; cliente?: Piloto | null; pedido?: Piloto | null } = {}) {
  const prisma = {
    piloto: { findUnique: () => Promise.resolve({ empresaId: 1, pedido: null, ...piloto }) },
    produto: { findUnique: () => Promise.resolve(extras.produto ?? null) },
    cliente: { findUnique: () => Promise.resolve(extras.cliente ?? null) },
    pedido: { findUnique: () => Promise.resolve(extras.pedido ?? null) },
  };
  return new PilotosService(prisma as never);
}

const BASE = {
  id: 211, codigo: 'PIL-0208', empresaId: 1, clienteId: null, produtoId: null, pedidoId: null,
  clienteNome: 'GRSA - NON FOODS', modelagem: 'AVENTAL CURTO (ACIMA DO JOELHO) 70 x 50 cm',
  artigo: null, marca: null, cor: 'VERDE MUSGO', setor: 'COZINHA / SALÃO',
  tentativa: 1, status: 'em_desenvolvimento', briefingProduto: 'ACESSÓRIOS',
  solicitacao: new Date('2026-11-10T12:00:00Z'), envio: null, prazoRetorno: null,
};

describe('dados da etiqueta', () => {
  it('piloto avulso (sem produto) é nomeado pela modelagem, não por um travessão', async () => {
    const { dados } = await servico(BASE).etiqueta(211, 1);
    expect(dados.produto).toBe('AVENTAL CURTO (ACIMA DO JOELHO) 70 x 50 cm');
    expect(dados.cliente).toBe('GRSA - NON FOODS');
    expect(dados.tentativa).toBe(1);
  });

  it('o tecido da AMOSTRA vence o tecido padrão do produto', async () => {
    // A piloto existe justamente para testar um tecido diferente do de catálogo.
    const svc = servico(
      { ...BASE, produtoId: 9, artigo: 'UNILEVE 2x1 - 100% ALGODÃO', marca: 'SANTANENSE' },
      { produto: { codigo: 'PRD-CAL-0027', descricao: 'CALÇA VERDE MUSGO', tecido: 'BRIM MISTO', composicao: '67/33', grade: 'PP, P, M' } },
    );
    const { dados } = await svc.etiqueta(211, 1);
    expect(dados.artigo).toBe('UNILEVE 2x1 - 100% ALGODÃO');
    expect(dados.produto).toBe('CALÇA VERDE MUSGO'); // com produto, quem nomeia é ele
    expect(dados.tamanho).toBe('PP');
  });

  it('cliente vem do pedido quando o piloto nasceu de um', async () => {
    const svc = servico(
      { ...BASE, clienteNome: null, pedidoId: 7 },
      { pedido: { numero: 'PV210', cliente: { nome: 'CONSIGAZ' } } },
    );
    const { dados } = await svc.etiqueta(211, 1);
    expect(dados.cliente).toBe('CONSIGAZ');
    expect(dados.pedido).toBe('PV210');
  });

  it('data em branco vira travessão, não "Invalid Date"', async () => {
    const { dados } = await servico(BASE).etiqueta(211, 1);
    expect(dados.envio).toBe('—');
    expect(dados.prazoRetorno).toBe('—');
    expect(dados.solicitacao).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('piloto de outra empresa não é impresso', async () => {
    await expect(servico({ ...BASE, empresaId: 2 }).etiqueta(211, 1)).rejects.toThrow(/não encontrado/i);
  });
});

describe('o ZPL cabe na etiqueta de 100x50', () => {
  // 100x50 mm @203dpi = 800 x 400 pontos. O código de barras tem 80 de altura
  // mais a legenda; o QR ocupa de x=600 para a direita.
  const medir = (zpl: string) => {
    const textos = [...zpl.matchAll(/\^FO(\d+),(\d+)\^FD(.*?)\^FS/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), txt: m[3] }));
    const barras = /\^FO\d+,(\d+)\^BY2/.exec(zpl)!;
    return { textos, barrasY: Number(barras[1]) };
  };

  it('nenhum texto desce sobre o código de barras, e o código cabe na altura', async () => {
    const { zpl } = await servico(BASE).etiqueta(211, 1);
    const { textos, barrasY } = medir(zpl);
    const ultimo = Math.max(...textos.filter((t) => t.x < 600).map((t) => t.y));
    expect(ultimo + 26).toBeLessThanOrEqual(barrasY);
    expect(barrasY + 80 + 26).toBeLessThanOrEqual(400);
  });

  it('o nome comprido da peça não avança sobre o QR', async () => {
    const svc = servico({ ...BASE, modelagem: 'AVENTAL CURTO (ACIMA DO JOELHO) 70 x 50 cm COM BOLSO FRONTAL E COS SINTETICO' });
    const { zpl } = await svc.etiqueta(211, 1);
    const linha = medir(zpl).textos.find((t) => t.txt.startsWith('AVENTAL'))!;
    expect(linha.txt.length).toBeLessThanOrEqual(44);
  });

  it('o QR leva o que identifica a amostra — inclusive a tentativa', async () => {
    const svc = servico({ ...BASE, tentativa: 3, artigo: '11 GRASS', marca: 'ADAR' });
    const { zpl } = await svc.etiqueta(211, 1);
    const qr = /\^FDLA,(\{.*?\})\^FS/s.exec(zpl)!;
    const j = JSON.parse(qr[1]);
    expect(j).toMatchObject({ piloto: 'PIL-0208', tentativa: 3, artigo: '11 GRASS', marca: 'ADAR' });
  });

  it('acento e caractere de controle do ZPL não quebram a etiqueta', async () => {
    const svc = servico({ ...BASE, clienteNome: 'ATTA ^ GASTRONOMIA ~ LTDA', cor: 'VERDE MUSGO' });
    const { zpl } = await svc.etiqueta(211, 1);
    const linha = medir(zpl).textos.find((t) => t.txt.startsWith('Cliente:'))!;
    expect(linha.txt).not.toMatch(/[\^~]/);
    expect(zpl).toContain('^CI28'); // UTF-8 ligado: acento sai certo na Zebra
  });
});
