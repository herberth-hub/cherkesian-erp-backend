/**
 * API DO SANTANDER — autenticação (mTLS + OAuth2).
 *
 * ESTADO: conecta, mas ainda NÃO puxa extrato.
 *
 * O que está provado e implementado aqui é a porta de entrada: certificado
 * A1 apresentado no TLS, client id + client secret trocados por um access
 * token. O que falta é o caminho do extrato e o formato da resposta — isso só
 * sai da Documentação Técnica de dentro do portal, depois que o gerente
 * liberar a API para o CNPJ. Por isso `buscar()` e `saldo()` recusam com uma
 * frase que diz o que falta, em vez de inventar um endpoint.
 *
 * Fazer a autenticação antes do resto não é adiantar trabalho à toa: é o
 * pedaço que mais dá errado. No Cora, o que custou dias não foi o extrato —
 * foi o certificado chegando quebrado no Render, que apaga as linhas
 * "-----BEGIN-----" do valor. Com isto aqui, o certificado do Santander pode
 * ser testado no dia em que ele entrar, sem esperar o resto.
 *
 * O QUE O BANCO EXIGE (confirmado em 17/11/2026):
 *   - certificado A1 (ICP-Brasil), 2048 bits, PEM com a CADEIA COMPLETA
 *     (raiz + intermediário + folha), validade mínima de 90 dias;
 *   - aplicação criada EM PRODUÇÃO no portal, por um administrador;
 *   - a API de extrato liberada para o CNPJ — se ela não aparecer na lista,
 *     quem libera é o gerente da conta.
 *
 * HOST: `trust-open.api.santander.com.br` responde TLS e devolve 403 para
 * quem chega sem certificado de cliente — o comportamento esperado de um
 * endereço fechado por mTLS. O caminho `/auth/oauth/v2/token` vem da
 * documentação de integradores (Tecnospeed) e ainda será conferido contra a
 * Documentação Técnica do portal.
 *
 * CREDENCIAIS NUNCA FICAM NO BANCO NEM NO CÓDIGO. Vêm do ambiente (Render),
 * onde só o Herberth coloca.
 */
import { Agent, request } from 'https';
import { ExtratoDoBanco, FonteExtratoApi } from './extrato-fonte';
import { blocosDoCertificado, conferirPem, normalizarPem, validadeDoCertificado } from './credencial-mtls';

const BASES: Record<string, string> = {
  producao: 'https://trust-open.api.santander.com.br',
  homologacao: 'https://trust-sandbox.api.santander.com.br',
};

/** Caminho do token. Isolado porque é o que pode mudar quando a doc chegar. */
export const CAMINHO_TOKEN = '/auth/oauth/v2/token';

export interface SantanderCredenciais {
  clientId: string;
  clientSecret: string;
  certPem: string;
  keyPem: string;
  ambiente?: string;
  /** Só para teste/override: a base já pronta. */
  baseUrl?: string;
}

/**
 * UMA CREDENCIAL POR CONTA — mesma regra do Cora.
 *
 * A aplicação do portal é criada por CNPJ, e o token que ela gera abre a conta
 * daquele CNPJ. Como a tela oferece todas as contas, o nome da variável carrega
 * o CNPJ: assim não há como a credencial da Yerevan puxar extrato debaixo da
 * HC Quality.
 *
 *   SANTANDER_60996521000172_CLIENT_ID / _CLIENT_SECRET / _CERT_PEM / _KEY_PEM
 */
export function prefixoDoCnpj(cnpj?: string | null): string {
  const d = String(cnpj ?? '').replace(/\D/g, '');
  return d ? `SANTANDER_${d}_` : 'SANTANDER_';
}

/**
 * As variáveis desta conta como LISTA, com o que cada uma é.
 *
 * São QUATRO, uma a mais que o Cora: o Santander pede client secret além do
 * client id. A tela percorre a lista justamente para isso — banco nenhum
 * combinou de ter as mesmas credenciais.
 */
export function listaDasVariaveis(cnpj?: string | null): Array<{ nome: string; oQueE: string }> {
  const p = prefixoDoCnpj(cnpj);
  return [
    { nome: `${p}CLIENT_ID`, oQueE: 'Client ID da aplicação criada no Portal do Desenvolvedor' },
    { nome: `${p}CLIENT_SECRET`, oQueE: 'Client Secret da mesma aplicação' },
    { nome: `${p}CERT_PEM`, oQueE: 'certificado A1 com a cadeia completa, em base64' },
    { nome: `${p}KEY_PEM`, oQueE: 'chave privada do certificado, em base64' },
  ];
}

function lerPrefixo(env: NodeJS.ProcessEnv, prefixo: string): SantanderCredenciais | null {
  const clientId = String(env[`${prefixo}CLIENT_ID`] ?? '').trim();
  const clientSecret = String(env[`${prefixo}CLIENT_SECRET`] ?? '').trim();
  const certPem = normalizarPem(env[`${prefixo}CERT_PEM`]);
  const keyPem = normalizarPem(env[`${prefixo}KEY_PEM`]);
  if (!clientId || !clientSecret || !certPem || !keyPem) return null;
  return {
    clientId, clientSecret, certPem, keyPem,
    ambiente: String(env[`${prefixo}AMBIENTE`] ?? env.SANTANDER_AMBIENTE ?? 'producao').trim() || 'producao',
  };
}

/**
 * Lê as credenciais da conta. Devolve null (em vez de explodir) quando não há
 * nada configurado: a ausência de integração não é erro, é só uma conta que
 * ainda importa OFX na mão.
 */
export function credenciaisDoAmbiente(env: NodeJS.ProcessEnv = process.env, cnpj?: string | null): SantanderCredenciais | null {
  const proprias = cnpj ? lerPrefixo(env, prefixoDoCnpj(cnpj)) : null;
  return proprias ?? lerPrefixo(env, 'SANTANDER_');
}

/** Esta conta tem credencial PRÓPRIA (não está usando a padrão)? */
export function temCredencialPropria(env: NodeJS.ProcessEnv = process.env, cnpj?: string | null): boolean {
  return !!cnpj && lerPrefixo(env, prefixoDoCnpj(cnpj)) !== null;
}

/** O que falta configurar, em português, para a tela poder dizer. */
export function oQueFalta(env: NodeJS.ProcessEnv = process.env, cnpj?: string | null): string[] {
  const p = prefixoDoCnpj(cnpj);
  const faltas: string[] = [];
  for (const v of listaDasVariaveis(cnpj)) {
    const chave = v.nome.slice(p.length);
    const valor = chave.endsWith('_PEM') ? normalizarPem(env[v.nome]) : String(env[v.nome] ?? '').trim();
    if (!valor) faltas.push(`${v.nome} (${v.oQueE})`);
  }
  return faltas;
}

/**
 * Problemas no VALOR das credenciais já preenchidas.
 *
 * Variável preenchida não quer dizer valor bom. Além das conferências de PEM
 * que todo banco tem, aqui entra a da CADEIA: o Santander exige raiz +
 * intermediário + folha no mesmo arquivo, e mandar só a folha falha no TLS com
 * um erro que não diz o que falta.
 */
export function problemasDaCredencial(cred: SantanderCredenciais): string[] {
  const p = [conferirPem(cred.certPem, 'certificado'), conferirPem(cred.keyPem, 'chave')]
    .filter((x): x is string => !!x);
  if (p.length) return p;
  if (blocosDoCertificado(cred.certPem) < 2) {
    p.push(
      'certificado: veio com um bloco só. O Santander exige a CADEIA COMPLETA no mesmo arquivo '
      + '(raiz + intermediário + folha) — peça o PEM encadeado a quem emitiu o A1.',
    );
  }
  const val = validadeDoCertificado(cred.certPem);
  if (val?.vencido) p.push(`certificado: VENCEU em ${val.vence.toLocaleDateString('pt-BR')} — emita um A1 novo.`);
  else if (val && val.diasRestantes < 90) {
    p.push(
      `certificado: vence em ${val.diasRestantes} dia(s). O Santander só aceita certificado com `
      + 'pelo menos 90 dias de validade no cadastro da aplicação.',
    );
  }
  return p;
}

type Resposta = { status: number; corpo: string };

/**
 * A mensagem que `buscar()` e `saldo()` devolvem enquanto a documentação não
 * chega. Fica numa constante porque é o que a tela mostra, e tem de dizer o
 * passo seguinte, não só "não implementado".
 */
export const FALTA_DOCUMENTACAO =
  'A conexão com o Santander já funciona (certificado e credenciais), mas o endpoint de extrato ainda não está '
  + 'configurado: falta a Documentação Técnica da API, que só aparece dentro do Portal do Desenvolvedor depois '
  + 'que o gerente libera a API de extrato para o CNPJ. Enquanto isso, use "Importar extrato (OFX)".';

export class SantanderFonte implements FonteExtratoApi {
  readonly nome = 'Santander';
  /** Ainda não puxa extrato — a tela usa isto para testar só a conexão. */
  readonly pronta = false;
  private readonly base: string;
  private readonly agente: Agent;
  private token: { valor: string; expiraEm: number } | null = null;

  constructor(private readonly cred: SantanderCredenciais) {
    const amb = (cred.ambiente ?? 'producao').toLowerCase();
    this.base = cred.baseUrl ?? BASES[amb] ?? BASES.producao;
    // Confere ANTES de montar o agente: o erro do OpenSSL é indecifrável, e
    // montar com PEM quebrado estoura lá no meio da conexão.
    const problemas = [conferirPem(cred.certPem, 'certificado'), conferirPem(cred.keyPem, 'chave')].filter(Boolean);
    if (problemas.length) {
      throw new Error(`A credencial do Santander está mal colada — ${problemas.join('; ')}.`);
    }
    try {
      this.agente = new Agent({ cert: cred.certPem, key: cred.keyPem, keepAlive: true });
    } catch (e) {
      throw new Error(`O certificado ou a chave do Santander não foram aceitos: ${(e as Error).message}`);
    }
  }

  /**
   * Autentica e devolve o token. É o teste de conexão: se isto passa, o
   * certificado está certo, foi aceito no mTLS e a aplicação existe.
   */
  async conectar(): Promise<void> {
    await this.autenticar();
  }

  /** Token em cache; renova faltando 5 min para vencer. */
  private async autenticar(): Promise<string> {
    const agora = Date.now();
    if (this.token && this.token.expiraEm - 300_000 > agora) return this.token.valor;
    const corpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cred.clientId,
      client_secret: this.cred.clientSecret,
    }).toString();
    const r = await this.http('POST', CAMINHO_TOKEN, corpo, { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (r.status !== 200) throw new Error(this.explicarFalhaDeToken(r));
    let json: { access_token?: string; expires_in?: number };
    try { json = JSON.parse(r.corpo); } catch { throw new Error('Santander devolveu uma resposta de token que não é JSON.'); }
    if (!json.access_token) throw new Error('Santander não devolveu access_token.');
    this.token = { valor: json.access_token, expiraEm: agora + Number(json.expires_in ?? 900) * 1000 };
    return this.token.valor;
  }

  /**
   * Por que o token foi recusado, em português.
   *
   * Cada código tem uma causa provável diferente, e adivinhar errado aqui custa
   * horas: o 403 do Akamai, por exemplo, é o certificado não chegando na
   * conexão — não tem nada a ver com client id.
   */
  private explicarFalhaDeToken(r: Resposta): string {
    const v = validadeDoCertificado(this.cred.certPem);
    if (v?.vencido) {
      return `O certificado do Santander VENCEU em ${v.vence.toLocaleDateString('pt-BR')}. `
        + 'Emita um A1 novo, cadastre no Portal do Desenvolvedor e atualize as variáveis no Render.';
    }
    if (r.status === 403) {
      return 'O Santander recusou a conexão antes do login (HTTP 403). Quase sempre é o certificado: '
        + 'ou não foi apresentado, ou não é o mesmo que está cadastrado na aplicação do portal, '
        + 'ou veio sem a cadeia completa.';
    }
    if (r.status === 401) {
      return 'O Santander recusou as credenciais (HTTP 401). Confira o Client ID e o Client Secret da aplicação '
        + 'EM PRODUÇÃO — os de homologação não valem aqui.';
    }
    if (r.status === 404) {
      return `O endereço do token não existe neste ambiente (HTTP 404 em ${CAMINHO_TOKEN}). `
        + 'Confira na Documentação Técnica do portal qual é o caminho do token.';
    }
    return `Santander recusou a autenticação (HTTP ${r.status}). Confira a aplicação no portal e o ambiente (${this.cred.ambiente}).`;
  }

  private http(metodo: string, caminho: string, corpo: string | null, headers: Record<string, string>): Promise<Resposta> {
    const url = new URL(this.base + caminho);
    return new Promise((ok, falha) => {
      const req = request(
        {
          method: metodo,
          host: url.hostname,
          path: url.pathname + url.search,
          agent: this.agente,
          headers: { ...headers, ...(corpo ? { 'Content-Length': Buffer.byteLength(corpo) } : {}) },
          timeout: 30_000,
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (c: Buffer) => partes.push(c));
          res.on('end', () => ok({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }));
        },
      );
      req.on('timeout', () => { req.destroy(new Error('Santander não respondeu em 30s.')); });
      req.on('error', (e) => falha(new Error(`Falha ao falar com o Santander: ${e.message}`)));
      if (corpo) req.write(corpo);
      req.end();
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async buscar(_de: Date, _ate: Date): Promise<ExtratoDoBanco> {
    throw new Error(FALTA_DOCUMENTACAO);
  }

  async saldo(): Promise<number | null> {
    throw new Error(FALTA_DOCUMENTACAO);
  }
}
