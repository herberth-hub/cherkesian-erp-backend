/**
 * Anexos fora do banco.
 *
 * O que dá para provar sem bucket de verdade: que o sistema continua igual
 * enquanto o storage está desligado, que referência e data URI são
 * distinguidos, e — o mais importante — que a URL assinada não deixa ninguém
 * ler um anexo sem link válido. A rota é pública (o `<img>` não manda
 * cabeçalho), então a assinatura É o controle de acesso.
 */
import { ArquivosService } from './arquivos.service';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function servico(env: Record<string, string> = {}): ArquivosService {
  const antes = { ...process.env };
  for (const k of ['ARQUIVOS_ENDPOINT', 'ARQUIVOS_CHAVE', 'ARQUIVOS_SEGREDO', 'ARQUIVOS_BUCKET']) delete process.env[k];
  Object.assign(process.env, { ARQUIVOS_URL_SEGREDO: 'segredo-de-teste' }, env);
  const s = new ArquivosService();
  process.env = antes;
  return s;
}

describe('ArquivosService', () => {
  it('fica desligado sem configuração e devolve o data URI intacto', async () => {
    const s = servico();
    expect(s.ligado).toBe(false);
    await expect(s.guardar(PNG_1PX, 'produtos')).resolves.toBe(PNG_1PX);
  });

  it('distingue referência de bucket de data URI', () => {
    expect(ArquivosService.ehReferencia('arq:mapas/abc.png')).toBe(true);
    expect(ArquivosService.ehReferencia(PNG_1PX)).toBe(false);
    expect(ArquivosService.ehReferencia(null)).toBe(false);
    expect(ArquivosService.chaveDaReferencia('arq:mapas/abc.png')).toBe('mapas/abc.png');
  });

  it('lê os bytes de um data URI sem precisar de bucket', async () => {
    const s = servico();
    const a = await s.bytes(PNG_1PX);
    expect(a?.tipo).toBe('image/png');
    expect(a?.bytes.length).toBeGreaterThan(0);
  });

  it('não gera link para anexo que ainda está no banco', () => {
    expect(servico().url(PNG_1PX)).toBeNull();
  });

  describe('URL assinada', () => {
    const env = {
      ARQUIVOS_ENDPOINT: 'https://exemplo.r2.cloudflarestorage.com',
      ARQUIVOS_CHAVE: 'k', ARQUIVOS_SEGREDO: 's', ARQUIVOS_BUCKET: 'b',
    };

    it('aceita a assinatura que ela mesma gerou', () => {
      const s = servico(env);
      const url = s.url('arq:mapas/abc.png');
      expect(url).toContain('/api/v1/arquivos/mapas/abc.png');
      const q = new URLSearchParams(url!.split('?')[1]);
      expect(s.conferirAssinatura('mapas/abc.png', q.get('e')!, q.get('a')!)).toBe(true);
    });

    it('recusa assinatura de OUTRA chave — não dá para trocar o caminho no link', () => {
      const s = servico(env);
      const q = new URLSearchParams(s.url('arq:mapas/abc.png')!.split('?')[1]);
      expect(s.conferirAssinatura('boletos/segredo.pdf', q.get('e')!, q.get('a')!)).toBe(false);
    });

    it('recusa link vencido', () => {
      const s = servico(env);
      const expirou = String(Math.floor(Date.now() / 1000) - 10);
      const q = new URLSearchParams(s.url('arq:mapas/abc.png')!.split('?')[1]);
      expect(s.conferirAssinatura('mapas/abc.png', expirou, q.get('a')!)).toBe(false);
    });

    it('recusa assinatura inventada ou vazia', () => {
      const s = servico(env);
      const q = new URLSearchParams(s.url('arq:mapas/abc.png')!.split('?')[1]);
      expect(s.conferirAssinatura('mapas/abc.png', q.get('e')!, 'qualquer-coisa')).toBe(false);
      expect(s.conferirAssinatura('mapas/abc.png', q.get('e')!, '')).toBe(false);
    });
  });
});
