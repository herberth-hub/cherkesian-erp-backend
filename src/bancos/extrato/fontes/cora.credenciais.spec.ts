/**
 * AS CREDENCIAIS DO CORA.
 *
 * Elas nunca ficam no banco nem no código: client id, certificado e chave
 * privada vêm do ambiente, cadastrados no Render pelo dono. O que este teste
 * segura é o caminho até lá — o PEM colado num campo de uma linha chega com
 * os "\n" escapados e o TLS falha com uma mensagem que não ajuda ninguém, e
 * uma configuração pela metade tem de dizer O QUE falta, não "erro 500".
 */
import { credenciaisDoAmbiente, normalizarPem, oQueFalta } from './cora.fonte';

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
const completo = { CORA_CLIENT_ID: 'int-abc123', CORA_CERT_PEM: CERT, CORA_KEY_PEM: KEY } as NodeJS.ProcessEnv;

describe('PEM colado em variável de ambiente', () => {
  it('desfaz o \\n escapado — sem isso o certificado não carrega', () => {
    expect(normalizarPem('-----BEGIN CERTIFICATE-----\\nMIIB...\\n-----END CERTIFICATE-----'))
      .toBe('-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----');
  });

  it('PEM que já veio com quebra de linha de verdade passa intacto', () => {
    expect(normalizarPem(CERT)).toBe(CERT);
  });

  it('espaço sobrando nas pontas não entra no certificado', () => {
    expect(normalizarPem('  ' + CERT + '\n ')).toBe(CERT);
  });

  it('vazio continua vazio — não vira string "undefined"', () => {
    expect(normalizarPem(undefined)).toBe('');
    expect(normalizarPem(null)).toBe('');
  });
});

describe('ler o ambiente', () => {
  it('com tudo configurado, devolve as credenciais', () => {
    const c = credenciaisDoAmbiente(completo);
    expect(c).toMatchObject({ clientId: 'int-abc123', ambiente: 'producao' });
    expect(c!.certPem).toContain('BEGIN CERTIFICATE');
  });

  it('sem configuração, devolve null — conta sem API não é erro, é conta que usa OFX', () => {
    expect(credenciaisDoAmbiente({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('configuração pela metade também é null: meio certificado não autentica', () => {
    expect(credenciaisDoAmbiente({ CORA_CLIENT_ID: 'x' } as NodeJS.ProcessEnv)).toBeNull();
    expect(credenciaisDoAmbiente({ ...completo, CORA_KEY_PEM: '' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('homologação é respeitada quando pedida', () => {
    expect(credenciaisDoAmbiente({ ...completo, CORA_AMBIENTE: 'homologacao' })!.ambiente).toBe('homologacao');
  });
});

describe('dizer o que falta, não "erro 500"', () => {
  it('lista item por item', () => {
    const f = oQueFalta({} as NodeJS.ProcessEnv);
    expect(f).toHaveLength(3);
    expect(f.join(' ')).toContain('CORA_CLIENT_ID');
    expect(f.join(' ')).toContain('CORA_CERT_PEM');
    expect(f.join(' ')).toContain('CORA_KEY_PEM');
  });

  it('aponta só o que realmente falta', () => {
    expect(oQueFalta({ ...completo, CORA_KEY_PEM: '' } as NodeJS.ProcessEnv)).toEqual([
      'CORA_KEY_PEM (conteúdo da private-key.key)',
    ]);
  });

  it('com tudo no lugar, não falta nada', () => {
    expect(oQueFalta(completo)).toEqual([]);
  });
});
