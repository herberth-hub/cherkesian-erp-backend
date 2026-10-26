/**
 * A ROTA do anexo, não só a assinatura.
 *
 * O controller tinha sido escrito com `@Get('*chave')`, que é curinga do
 * Express 5. Este projeto roda Nest 10 sobre Express 4, onde isso não casa com
 * nada: a rota respondia 404 e TODA imagem vinda do bucket aparecia quebrada no
 * catálogo. Os testes de unidade da assinatura passavam, porque o problema não
 * estava nela — estava no caminho até ela.
 *
 * Por isso aqui sobe a aplicação de verdade e faz o GET.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { ArquivosController } from './arquivos.controller';
import { ArquivosService } from './arquivos.service';

const CHAVE = 'produtos/162-abc.jpg';
const BYTES = Buffer.from('imagem-falsa');

describe('GET /arquivos/* (rota do anexo)', () => {
  let app: INestApplication;
  let arquivos: ArquivosService;

  beforeAll(async () => {
    process.env.ARQUIVOS_URL_SEGREDO = 'segredo-de-teste';
    const mod = await Test.createTestingModule({
      controllers: [ArquivosController],
      providers: [
        {
          provide: ArquivosService,
          useValue: Object.assign(Object.create(ArquivosService.prototype), {
            // Só o download é simulado; a assinatura é a real da classe.
            bytes: async (v: string) =>
              v === `arq:${CHAVE}` ? { tipo: 'image/jpeg', bytes: BYTES } : null,
            segredo: 'segredo-de-teste',
          }),
        },
        // Sem guard global no módulo de teste, @Public() não muda nada:
        // o importante aqui é a rota resolver e a assinatura ser conferida.
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    arquivos = app.get(ArquivosService);
  });

  afterAll(async () => { await app?.close(); });

  const partes = () => {
    const url = arquivos.url(`arq:${CHAVE}`)!;
    const [caminho, query] = url.split('?');
    const q = new URLSearchParams(query);
    return { caminho, e: q.get('e')!, a: q.get('a')! };
  };

  it('entrega o arquivo quando o link está assinado', async () => {
    const { caminho, e, a } = partes();
    const r = await request(app.getHttpServer()).get(caminho).query({ e, a });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(r.body).toString()).toBe(BYTES.toString());
  });

  it('a chave com barras chega inteira ao serviço (o curinga não corta a pasta)', () => {
    expect(partes().caminho).toBe(`/api/v1/arquivos/${CHAVE}`);
  });

  it('recusa sem assinatura', async () => {
    const { caminho } = partes();
    expect((await request(app.getHttpServer()).get(caminho)).status).toBe(403);
  });

  it('recusa assinatura emitida para OUTRA chave', async () => {
    const { e, a } = partes();
    const r = await request(app.getHttpServer()).get('/api/v1/arquivos/boletos/sigiloso.pdf').query({ e, a });
    expect(r.status).toBe(403);
  });

  it('recusa link vencido', async () => {
    const { caminho, a } = partes();
    const vencido = String(Math.floor(Date.now() / 1000) - 60);
    expect((await request(app.getHttpServer()).get(caminho).query({ e: vencido, a })).status).toBe(403);
  });
});
