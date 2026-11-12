/**
 * AS CREDENCIAIS DO CORA.
 *
 * Elas nunca ficam no banco nem no código: client id, certificado e chave
 * privada vêm do ambiente, cadastrados no Render pelo dono. O que este teste
 * segura é o caminho até lá — o PEM colado num campo de uma linha chega com
 * os "\n" escapados e o TLS falha com uma mensagem que não ajuda ninguém, e
 * uma configuração pela metade tem de dizer O QUE falta, não "erro 500".
 */
import { conferirPem, credenciaisDoAmbiente, nomesDasVariaveis, normalizarPem, oQueFalta, temCredencialPropria, validadeDoCertificado } from './cora.fonte';

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

/**
 * A VALIDADE DA CREDENCIAL.
 *
 * O Cora emite por 1 ano e desativa sozinho. Sem isso, a integração pararia
 * num dia qualquer com um 401 que ninguém saberia ler. A data não é cadastrada
 * em lugar nenhum: está dentro do próprio certificado — não há o que esquecer
 * de preencher.
 */
describe('validade lida do certificado', () => {
  /**
   * Certificado autoassinado DESCARTÁVEL, gerado só para este teste. Não serve
   * para nada em lugar nenhum — a chave dele foi jogada fora. Vence em
   * 17/12/2027, e é contra essa data que o cálculo é conferido.
   */
  const CERT_TESTE = [
    '-----BEGIN CERTIFICATE-----',
    'MIIC4TCCAcmgAwIBAgIUcyWY2GnnreBx8h6EtqCKJcBshbMwDQYJKoZIhvcNAQEL',
    'BQAwADAeFw0yNjExMTIxMTM5MDVaFw0yNzEyMTcxMTM5MDVaMAAwggEiMA0GCSqG',
    'SIb3DQEBAQUAA4IBDwAwggEKAoIBAQC4AWzOr9byogkaOSsxeWYMM3MCqxQuxUCf',
    'ugkY1+opz/pl8NwO3r2tFHWhIrjXN2bRsFrsHhphWnwqF8hNcPlIF14F1NcwpQ66',
    'lV6MFlGZhHJUy1wViVSe4AWCr/TwmKhu8d6IGEFyI9dKkYs6MvzJkfa5+M6NNLAy',
    '43ucqRA4hSnE/an/mB4ezABbnMwlnG0SG7raZGDeZhVWPe2CEV+8NxmJ6GV5TqK/',
    '3t7LPxMFjLlTFm6ErfGguTlSK1jc3h0fTFeYGpgVa51+aJNyK9PcCtZH3XFmIrrD',
    'SAfribZEW2Sn5leWcCsKbR+Kul2wJqNVs5Dz7sPNgK+lyRtztKkpAgMBAAGjUzBR',
    'MB0GA1UdDgQWBBRNYHrOT8v+aJh8PmEBvwbKn3A5OTAfBgNVHSMEGDAWgBRNYHrO',
    'T8v+aJh8PmEBvwbKn3A5OTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA',
    'A4IBAQBVE6fT3tPOKm2V3GaWXdSjMmW7XsLWdhHRXXfi05uMEjfGzvs0KqZNNmAG',
    '2aS4FOyWOawQQwILXE64U9/2BrX8ani+piydgyhf0bsT+MPY3bTFVlx0MdxI1xib',
    'fa4JMdn6xq0Ptjg/+D1HSW7Zss56seSN6VB/G4SgX1O8xSzOWy01vls0lOVP8XhM',
    '9QojEgh9yxoOrKJEd8Prxq/+e1HiyN/RWRh7Dwp5AZ1Mey+KCxm2+xLnsjM3SnXD',
    'Xs5wLOvM4uSLcwOFtT6go6nu+giF5k6dNtGmvRXsr+YBczeb6kP83799xj++qdZc',
    'ZYzLGdE2hzJ8Njq64r3gBhCAD/cX',
    '-----END CERTIFICATE-----',
  ].join('\n');

  it('lê a data de vencimento de dentro do certificado', () => {
    const v = validadeDoCertificado(CERT_TESTE, new Date('2026-11-12T12:00:00Z'));
    expect(v).not.toBeNull();
    expect(v!.vence.toISOString().slice(0, 10)).toBe('2027-12-17');
  });

  it('um ano antes: falta muito, nada a avisar', () => {
    const v = validadeDoCertificado(CERT_TESTE, new Date('2026-11-12T12:00:00Z'))!;
    expect(v.diasRestantes).toBeGreaterThan(300);
    expect(v.perto).toBe(false);
    expect(v.vencido).toBe(false);
  });

  it('faltando 10 dias, avisa ANTES de parar', () => {
    const v = validadeDoCertificado(CERT_TESTE, new Date('2027-12-07T12:00:00Z'))!;
    expect(v.diasRestantes).toBe(9);
    expect(v.perto).toBe(true);
    expect(v.vencido).toBe(false);
  });

  it('exatamente 30 dias já conta como perto — dá tempo de pedir outra', () => {
    expect(validadeDoCertificado(CERT_TESTE, new Date('2027-11-17T12:00:00Z'))!.perto).toBe(true);
  });

  it('depois do vencimento, diz que venceu — é a causa mais provável de um 401', () => {
    const v = validadeDoCertificado(CERT_TESTE, new Date('2028-01-05T12:00:00Z'))!;
    expect(v.vencido).toBe(true);
    expect(v.diasRestantes).toBeLessThan(0);
  });

  it('certificado ilegível não derruba nada — devolve null', () => {
    expect(validadeDoCertificado('isto não é um certificado')).toBeNull();
    expect(validadeDoCertificado('')).toBeNull();
  });
});

/**
 * UMA CREDENCIAL POR CONTA.
 *
 * O Herberth tem tres contas no Cora, cada uma num CNPJ. Uma credencial nao
 * abre a conta da outra — foi medido: a primeira so respondia pelo CNPJ
 * 45704956000293. Entao o nome da variavel carrega o CNPJ, e o sistema sabe
 * sozinho qual procurar.
 */
describe('credencial por CNPJ', () => {
  const MURIAE = '45704956000293';
  const BARUERI = '45704956000102';
  const env = {
    // padrão (a primeira conta ligada, antes de existir credencial por CNPJ)
    CORA_CLIENT_ID: 'padrao', CORA_CERT_PEM: CERT, CORA_KEY_PEM: KEY,
    // própria da matriz
    [`CORA_${BARUERI}_CLIENT_ID`]: 'int-barueri',
    [`CORA_${BARUERI}_CERT_PEM`]: CERT,
    [`CORA_${BARUERI}_KEY_PEM`]: KEY,
  } as NodeJS.ProcessEnv;

  it('o nome da variável leva o CNPJ — é o que a tela manda copiar', () => {
    expect(nomesDasVariaveis(BARUERI)).toEqual({
      clientId: 'CORA_45704956000102_CLIENT_ID',
      cert: 'CORA_45704956000102_CERT_PEM',
      key: 'CORA_45704956000102_KEY_PEM',
    });
  });

  it('CNPJ com máscara gera o mesmo nome de variável', () => {
    expect(nomesDasVariaveis('45.704.956/0001-02').clientId).toBe('CORA_45704956000102_CLIENT_ID');
  });

  it('conta com credencial própria usa a dela, não a padrão', () => {
    expect(credenciaisDoAmbiente(env, BARUERI)!.clientId).toBe('int-barueri');
    expect(temCredencialPropria(env, BARUERI)).toBe(true);
  });

  it('conta sem credencial própria cai na padrão — é a primeira que foi ligada', () => {
    expect(credenciaisDoAmbiente(env, MURIAE)!.clientId).toBe('padrao');
    expect(temCredencialPropria(env, MURIAE)).toBe(false);
  });

  it('sem padrão e sem a própria, não há credencial nenhuma', () => {
    const so = { [`CORA_${BARUERI}_CLIENT_ID`]: 'x', [`CORA_${BARUERI}_CERT_PEM`]: CERT, [`CORA_${BARUERI}_KEY_PEM`]: KEY } as NodeJS.ProcessEnv;
    expect(credenciaisDoAmbiente(so, MURIAE)).toBeNull();
  });

  it('credencial própria pela metade não vaza para a padrão sem avisar', () => {
    // Faltando a chave da própria, cai na padrão — e o que falta é nomeado
    // com o CNPJ, para a pessoa saber onde corrigir.
    const meio = { ...env, [`CORA_${BARUERI}_KEY_PEM`]: '' } as NodeJS.ProcessEnv;
    expect(credenciaisDoAmbiente(meio, BARUERI)!.clientId).toBe('padrao');
    expect(oQueFalta(meio, BARUERI)).toEqual(['CORA_45704956000102_KEY_PEM (conteúdo da private-key.key)']);
  });

  it('o que falta é listado com o nome exato da variável daquela conta', () => {
    const f = oQueFalta({} as NodeJS.ProcessEnv, MURIAE);
    expect(f).toHaveLength(3);
    expect(f[0]).toContain('CORA_45704956000293_CLIENT_ID');
  });
});

/**
 * O PEM MAL COLADO.
 *
 * Colar certificado em campo de formulario e onde tudo quebra. O OpenSSL
 * reclama com "error:0909006C:PEM routines:get_name:no start line" e o
 * usuario recebe "Erro interno no servidor. Referencia XXXX" — aconteceu de
 * verdade, nas duas contas, na primeira configuracao no Render.
 */
describe('conferir o PEM antes de tentar conectar', () => {
  it('PEM inteiro passa', () => {
    expect(conferirPem(CERT, 'certificado')).toBeNull();
    expect(conferirPem(KEY, 'chave')).toBeNull();
  });

  it('vazio: diz que está vazio', () => {
    expect(conferirPem('', 'certificado')).toContain('vazio');
  });

  it('sem a linha BEGIN: aponta o começo', () => {
    expect(conferirPem('MIIB...\n-----END CERTIFICATE-----', 'certificado')).toContain('BEGIN');
  });

  it('sem a linha END: sugere que o valor foi cortado', () => {
    expect(conferirPem('-----BEGIN CERTIFICATE-----\nMIIB...', 'certificado')).toContain('cortado');
  });

  it('numa linha só: manda colar o arquivo inteiro', () => {
    expect(conferirPem('-----BEGIN CERTIFICATE----- MIIB -----END CERTIFICATE-----', 'certificado'))
      .toContain('uma linha só');
  });

  it('com aspas em volta: manda tirar as aspas', () => {
    expect(conferirPem(`"${CERT}"`, 'certificado')).toContain('aspas');
  });

  it('valores TROCADOS entre as duas variáveis: diz que estão trocados', () => {
    expect(conferirPem(KEY, 'certificado')).toContain('trocados');
    expect(conferirPem(CERT, 'chave')).toContain('trocados');
  });

  it('o \n escapado do Render não é considerado erro', () => {
    const escapado = CERT.replace(/\n/g, '\n');
    expect(conferirPem(escapado, 'certificado')).toBeNull();
  });
});
