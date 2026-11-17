/**
 * AS CREDENCIAIS DO SANTANDER.
 *
 * Duas diferenças em relação ao Cora, e as duas custam tempo quando passam
 * despercebidas:
 *
 * 1. São QUATRO variáveis, não três — o Santander pede client SECRET além do
 *    client id. Uma tela que mostra três manda o Herberth cadastrar três e
 *    deixa a integração sem subir, sem dizer o porquê.
 * 2. O certificado tem de ter a CADEIA COMPLETA (raiz + intermediário +
 *    folha). Mandar só a folha conecta em alguns servidores e falha em
 *    outros, com erro de TLS que não diz o que falta.
 *
 * E o mais importante: enquanto a Documentação Técnica não chega, puxar
 * extrato tem de RECUSAR com uma frase que diz o próximo passo — não devolver
 * lista vazia, que seria lido como "não teve movimento".
 */
import {
  CAMINHO_TOKEN, FALTA_DOCUMENTACAO, SantanderFonte, credenciaisDoAmbiente,
  listaDasVariaveis, oQueFalta, prefixoDoCnpj, problemasDaCredencial, temCredencialPropria,
} from './santander.fonte';
import { blocosDoCertificado } from './credencial-mtls';
import { ehSantander } from '../extrato.service';

/** A conta real: YEREVAN CONFECÇÕES, ag 1176 cc 130015142. */
const CNPJ_YEREVAN = '60996521000172';

const FOLHA = '-----BEGIN CERTIFICATE-----\nMIIBfolha...\n-----END CERTIFICATE-----';
const CADEIA = [FOLHA, '-----BEGIN CERTIFICATE-----\nMIIBinter...\n-----END CERTIFICATE-----',
  '-----BEGIN CERTIFICATE-----\nMIIBraiz...\n-----END CERTIFICATE-----'].join('\n');
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEchave...\n-----END PRIVATE KEY-----';

const env = (extra: Record<string, string>) => extra as NodeJS.ProcessEnv;
const completo = (p: string) => env({
  [`${p}CLIENT_ID`]: 'app-prod-123', [`${p}CLIENT_SECRET`]: 'segredo-abc',
  [`${p}CERT_PEM`]: CADEIA, [`${p}KEY_PEM`]: KEY,
});

describe('as quatro variáveis', () => {
  it('são quatro, e o client secret é uma delas', () => {
    const nomes = listaDasVariaveis(CNPJ_YEREVAN).map((v) => v.nome);
    expect(nomes).toHaveLength(4);
    expect(nomes).toContain(`SANTANDER_${CNPJ_YEREVAN}_CLIENT_SECRET`);
  });

  it('o nome carrega o CNPJ — credencial de uma conta não abre a outra', () => {
    expect(prefixoDoCnpj(CNPJ_YEREVAN)).toBe(`SANTANDER_${CNPJ_YEREVAN}_`);
    expect(prefixoDoCnpj('60.996.521/0001-72')).toBe(`SANTANDER_${CNPJ_YEREVAN}_`);
  });

  it('sem CNPJ cai no prefixo padrão', () => {
    expect(prefixoDoCnpj(null)).toBe('SANTANDER_');
  });

  it('cada variável vem com a explicação do que é', () => {
    for (const v of listaDasVariaveis(CNPJ_YEREVAN)) expect(v.oQueE.length).toBeGreaterThan(10);
  });
});

describe('ler o ambiente', () => {
  it('com as quatro, devolve as credenciais', () => {
    const c = credenciaisDoAmbiente(completo(`SANTANDER_${CNPJ_YEREVAN}_`), CNPJ_YEREVAN);
    expect(c).toMatchObject({ clientId: 'app-prod-123', clientSecret: 'segredo-abc', ambiente: 'producao' });
  });

  it('sem nada, devolve null — conta sem API não é erro', () => {
    expect(credenciaisDoAmbiente(env({}), CNPJ_YEREVAN)).toBeNull();
  });

  it('faltando SÓ o client secret, não devolve credencial pela metade', () => {
    const e = completo(`SANTANDER_${CNPJ_YEREVAN}_`);
    delete e[`SANTANDER_${CNPJ_YEREVAN}_CLIENT_SECRET`];
    expect(credenciaisDoAmbiente(e, CNPJ_YEREVAN)).toBeNull();
  });

  it('credencial própria do CNPJ tem precedência sobre a padrão', () => {
    const e = { ...completo('SANTANDER_'), ...completo(`SANTANDER_${CNPJ_YEREVAN}_`) };
    e[`SANTANDER_${CNPJ_YEREVAN}_CLIENT_ID`] = 'so-da-yerevan';
    expect(credenciaisDoAmbiente(e, CNPJ_YEREVAN)!.clientId).toBe('so-da-yerevan');
    expect(temCredencialPropria(e, CNPJ_YEREVAN)).toBe(true);
  });

  it('usando a padrão, não se diz que a conta tem credencial própria', () => {
    expect(temCredencialPropria(completo('SANTANDER_'), CNPJ_YEREVAN)).toBe(false);
  });
});

describe('o que falta, em português', () => {
  it('lista as quatro quando não há nada', () => {
    const f = oQueFalta(env({}), CNPJ_YEREVAN);
    expect(f).toHaveLength(4);
    expect(f.join(' ')).toContain('Client Secret');
  });

  it('nomeia exatamente a que falta', () => {
    const e = completo(`SANTANDER_${CNPJ_YEREVAN}_`);
    delete e[`SANTANDER_${CNPJ_YEREVAN}_CERT_PEM`];
    const f = oQueFalta(e, CNPJ_YEREVAN);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(`SANTANDER_${CNPJ_YEREVAN}_CERT_PEM`);
  });

  it('com tudo cadastrado, não falta nada', () => {
    expect(oQueFalta(completo(`SANTANDER_${CNPJ_YEREVAN}_`), CNPJ_YEREVAN)).toEqual([]);
  });
});

describe('a cadeia do certificado', () => {
  it('conta os blocos do PEM', () => {
    expect(blocosDoCertificado(FOLHA)).toBe(1);
    expect(blocosDoCertificado(CADEIA)).toBe(3);
  });

  it('só a folha é recusado, dizendo o que pedir', () => {
    const p = problemasDaCredencial({ clientId: 'a', clientSecret: 'b', certPem: FOLHA, keyPem: KEY });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('CADEIA COMPLETA');
  });

  it('cadeia completa passa', () => {
    expect(problemasDaCredencial({ clientId: 'a', clientSecret: 'b', certPem: CADEIA, keyPem: KEY })).toEqual([]);
  });

  it('certificado e chave trocados é apontado antes da cadeia', () => {
    const p = problemasDaCredencial({ clientId: 'a', clientSecret: 'b', certPem: KEY, keyPem: CADEIA });
    expect(p.join(' ')).toContain('trocados');
  });
});

describe('a fonte', () => {
  const cred = { clientId: 'a', clientSecret: 'b', certPem: CADEIA, keyPem: KEY };

  it('recusa PEM mal colado antes de tentar conectar', () => {
    expect(() => new SantanderFonte({ ...cred, certPem: 'miolo-sem-cabecalho' }))
      .toThrow(/mal colada/i);
  });

  it('se declara NÃO PRONTA — a tela testa só a conexão', () => {
    expect(new SantanderFonte(cred).pronta).toBe(false);
    expect(typeof new SantanderFonte(cred).conectar).toBe('function');
  });

  it('puxar extrato RECUSA dizendo o que falta — não devolve lista vazia', async () => {
    await expect(new SantanderFonte(cred).buscar(new Date(), new Date())).rejects.toThrow(/Documentação Técnica/);
    await expect(new SantanderFonte(cred).saldo()).rejects.toThrow(/Documentação Técnica/);
  });

  it('a recusa diz o que fazer enquanto isso', () => {
    expect(FALTA_DOCUMENTACAO).toContain('OFX');
  });

  it('o caminho do token fica isolado, para trocar quando a doc chegar', () => {
    expect(CAMINHO_TOKEN).toBe('/auth/oauth/v2/token');
  });
});

describe('reconhecer a conta do Santander', () => {
  it('pelo código de compensação', () => {
    expect(ehSantander({ banco: 'Qualquer', codigoBanco: '033' })).toBe(true);
  });

  it('pelo nome, porque conta cadastrada à mão nem sempre tem o código', () => {
    expect(ehSantander({ banco: 'Santander', codigoBanco: null })).toBe(true);
    expect(ehSantander({ banco: 'santander yerevan (cobrança)', codigoBanco: '' })).toBe(true);
  });

  it('não confunde com os outros bancos', () => {
    expect(ehSantander({ banco: 'Cora', codigoBanco: '403' })).toBe(false);
    expect(ehSantander({ banco: 'Bradesco', codigoBanco: '237' })).toBe(false);
  });
});
