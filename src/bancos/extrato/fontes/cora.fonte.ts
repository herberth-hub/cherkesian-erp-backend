/**
 * API DO CORA — Integração Direta (mTLS).
 *
 * Autenticação: POST {base}/token com `grant_type=client_credentials` e o
 * client_id no corpo, apresentando CERTIFICADO + CHAVE PRIVADA na conexão
 * (mutual TLS). O token vale 24h, então fica em memória e só é renovado
 * quando falta pouco.
 *
 * Base (Integração Direta):
 *   produção     https://matls-clients.api.cora.com.br
 *   homologação  https://matls-clients.api.stage.cora.com.br
 *
 * CREDENCIAIS NUNCA FICAM NO BANCO NEM NO CÓDIGO. Elas vêm do ambiente
 * (Render), onde só o Herberth coloca:
 *   CORA_CLIENT_ID    client id da integração
 *   CORA_CERT_PEM     conteúdo do certificate.pem
 *   CORA_KEY_PEM      conteúdo da private-key.key
 *   CORA_AMBIENTE     producao | homologacao   (padrão: producao)
 *
 * Chave privada em variável de ambiente costuma chegar com os "\n" escapados
 * (é o que acontece ao colar um PEM num campo de uma linha), então eles são
 * desescapados aqui — sem isso o TLS falha com uma mensagem que não ajuda
 * ninguém.
 */
import { Agent } from 'https';
import { request } from 'https';
import { X509Certificate } from 'crypto';
import { ExtratoDoBanco, FonteExtratoApi } from './extrato-fonte';
import { CoraExtratoResposta, diaIso, traduzirExtratoCora } from './cora.traducao';

const BASES: Record<string, string> = {
  producao: 'https://matls-clients.api.cora.com.br',
  homologacao: 'https://matls-clients.api.stage.cora.com.br',
};

export interface CoraCredenciais {
  clientId: string;
  certPem: string;
  keyPem: string;
  ambiente?: string;
  /** Só para teste/override: a base já pronta. */
  baseUrl?: string;
}

/** PEM colado em variável de ambiente vem com \n literal — desfaz o escape. */
export function normalizarPem(texto: string | undefined | null): string {
  return String(texto ?? '').replace(/\\r/g, '').replace(/\\n/g, '\n').trim();
}

/**
 * Lê as credenciais do ambiente. Devolve null (em vez de explodir) quando não
 * há nada configurado: a ausência de integração não é erro, é só uma conta que
 * ainda importa OFX na mão.
 */
export function credenciaisDoAmbiente(env: NodeJS.ProcessEnv = process.env): CoraCredenciais | null {
  const clientId = String(env.CORA_CLIENT_ID ?? '').trim();
  const certPem = normalizarPem(env.CORA_CERT_PEM);
  const keyPem = normalizarPem(env.CORA_KEY_PEM);
  if (!clientId || !certPem || !keyPem) return null;
  return { clientId, certPem, keyPem, ambiente: String(env.CORA_AMBIENTE ?? 'producao').trim() || 'producao' };
}

/** O que falta configurar, em português, para a tela poder dizer. */
export function oQueFalta(env: NodeJS.ProcessEnv = process.env): string[] {
  const faltas: string[] = [];
  if (!String(env.CORA_CLIENT_ID ?? '').trim()) faltas.push('CORA_CLIENT_ID (client id da integração)');
  if (!normalizarPem(env.CORA_CERT_PEM)) faltas.push('CORA_CERT_PEM (conteúdo do certificate.pem)');
  if (!normalizarPem(env.CORA_KEY_PEM)) faltas.push('CORA_KEY_PEM (conteúdo da private-key.key)');
  return faltas;
}

type Resposta = { status: number; corpo: string };

/**
 * ATÉ QUANDO A CREDENCIAL VALE.
 *
 * O Cora emite por 1 ano e desativa sozinho — a integração pararia de puxar
 * extrato num dia qualquer, com um 401 que ninguém saberia interpretar. A data
 * não precisa ser cadastrada em lugar nenhum: ela está DENTRO do certificado.
 * Lendo de lá, não há o que o Herberth esquecer de preencher.
 */
export interface ValidadeCertificado {
  vence: Date;
  diasRestantes: number;
  /** Menos de 30 dias — hora de pedir a nova credencial. */
  perto: boolean;
  vencido: boolean;
}

export function validadeDoCertificado(certPem: string, hoje: Date = new Date()): ValidadeCertificado | null {
  try {
    const x = new X509Certificate(certPem);
    const vence = new Date(x.validTo);
    if (Number.isNaN(vence.getTime())) return null;
    const dias = Math.floor((vence.getTime() - hoje.getTime()) / 86_400_000);
    return { vence, diasRestantes: dias, perto: dias <= 30, vencido: dias < 0 };
  } catch {
    return null; // certificado ilegível: quem reclama é o TLS, com mensagem própria
  }
}

export class CoraFonte implements FonteExtratoApi {
  readonly nome = 'Cora';
  private readonly base: string;
  private readonly agente: Agent;
  private token: { valor: string; expiraEm: number } | null = null;

  constructor(private readonly cred: CoraCredenciais) {
    const amb = (cred.ambiente ?? 'producao').toLowerCase();
    this.base = cred.baseUrl ?? BASES[amb] ?? BASES.producao;
    // O certificado identifica a empresa na conexão: é o mTLS do Cora.
    this.agente = new Agent({ cert: cred.certPem, key: cred.keyPem, keepAlive: true });
  }

  /** Token em cache; renova faltando 5 min para vencer. */
  private async autenticar(): Promise<string> {
    const agora = Date.now();
    if (this.token && this.token.expiraEm - 300_000 > agora) return this.token.valor;
    const corpo = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cred.clientId }).toString();
    const r = await this.http('POST', '/token', corpo, { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (r.status !== 200) {
      // Credencial vencida é a causa MAIS PROVÁVEL de uma integração que
      // funcionava parar do nada — então a mensagem diz isso antes de mandar
      // conferir client id e ambiente.
      const v = validadeDoCertificado(this.cred.certPem);
      if (v?.vencido) {
        throw new Error(
          `A credencial do Cora VENCEU em ${v.vence.toLocaleDateString('pt-BR')}. ` +
          'Gere uma nova no Cora Web (Integrações via APIs › Integração Direta › Ambiente de produção) e atualize CORA_CERT_PEM e CORA_KEY_PEM.',
        );
      }
      throw new Error(`Cora recusou a autenticação (HTTP ${r.status}). Confira o client id, o certificado e o ambiente (${this.cred.ambiente}).`);
    }
    let json: { access_token?: string; expires_in?: number };
    try { json = JSON.parse(r.corpo); } catch { throw new Error('Cora devolveu uma resposta de token que não é JSON.'); }
    if (!json.access_token) throw new Error('Cora não devolveu access_token.');
    const dura = Number(json.expires_in ?? 86_400) * 1000;
    this.token = { valor: json.access_token, expiraEm: agora + dura };
    return this.token.valor;
  }

  private async autenticado(metodo: 'GET', caminho: string): Promise<Resposta> {
    const token = await this.autenticar();
    return this.http(metodo, caminho, null, { Authorization: `Bearer ${token}`, Accept: 'application/json' });
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
      req.on('timeout', () => { req.destroy(new Error('Cora não respondeu em 30s.')); });
      req.on('error', (e) => falha(new Error(`Falha ao falar com o Cora: ${e.message}`)));
      if (corpo) req.write(corpo);
      req.end();
    });
  }

  async buscar(de: Date, ate: Date): Promise<ExtratoDoBanco> {
    // Uma página pode não dar conta de um mês movimentado: busca até acabar.
    const lancamentos: ExtratoDoBanco['lancamentos'] = [];
    let resumo: ExtratoDoBanco | null = null;
    for (let pagina = 1; pagina <= 50; pagina++) {
      const q = new URLSearchParams({ start: diaIso(de), end: diaIso(ate), page: String(pagina), perPage: '500' });
      const r = await this.autenticado('GET', `/bank-statement/statement?${q.toString()}`);
      if (r.status !== 200) throw new Error(`Cora recusou a consulta de extrato (HTTP ${r.status}).`);
      let json: CoraExtratoResposta;
      try { json = JSON.parse(r.corpo); } catch { throw new Error('Cora devolveu um extrato que não é JSON.'); }
      const pedaco = traduzirExtratoCora(json);
      if (!resumo) resumo = pedaco;
      lancamentos.push(...pedaco.lancamentos);
      // Página incompleta = acabou. (`entries` vazio também para aqui.)
      if ((json.entries?.length ?? 0) < 500) break;
    }
    return {
      lancamentos,
      periodoIni: resumo?.periodoIni ?? de,
      periodoFim: resumo?.periodoFim ?? ate,
      saldo: resumo?.saldo ?? null,
      saldoEm: resumo?.saldoEm ?? null,
      titularDocumento: resumo?.titularDocumento ?? null,
      titularNome: resumo?.titularNome ?? null,
    };
  }

  async saldo(): Promise<number | null> {
    const r = await this.autenticado('GET', '/third-party/account/balance');
    if (r.status !== 200) throw new Error(`Cora recusou a consulta de saldo (HTTP ${r.status}).`);
    try {
      const j = JSON.parse(r.corpo) as { balance?: number | string };
      if (j.balance == null) return null;
      return Number(j.balance) / 100; // a API devolve centavos
    } catch { throw new Error('Cora devolveu um saldo que não é JSON.'); }
  }
}
