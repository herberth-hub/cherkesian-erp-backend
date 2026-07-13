import { cfg } from './config';

/**
 * Cliente da API REST do ERP Cherkesian (/api/v1).
 * O agente NUNCA acessa o banco direto — só estas rotas, autenticado como o
 * usuário `agente` (auditado). Na Fase 1 usamos apenas GET (leitura).
 */
class ErpClient {
  private token: string | null = null;
  private tokenExp = 0; // epoch ms

  private async login(): Promise<string> {
    if (!cfg.erpSenha) {
      throw new Error(
        'ERP_SENHA não definida. Crie o usuário "agente" no ERP (perfil total) e defina ERP_USER/ERP_SENHA no .env.',
      );
    }
    const resp = await fetch(`${cfg.erpBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: cfg.erpUser, senha: cfg.erpSenha }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Falha no login do ERP (HTTP ${resp.status}). ${txt.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { accessToken?: string };
    if (!data.accessToken) throw new Error('Login do ERP não retornou accessToken.');
    this.token = data.accessToken;
    // Renova de forma conservadora a cada ~10 min (o token vive mais que isso).
    this.tokenExp = Date.now() + 10 * 60 * 1000;
    return this.token;
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    return this.login();
  }

  /** GET autenticado; re-loga uma vez em caso de 401. */
  async get(path: string, query?: Record<string, unknown>): Promise<unknown> {
    const url = new URL(cfg.erpBaseUrl + (path.startsWith('/') ? path : '/' + path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    let token = await this.auth();
    let resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401) {
      this.token = null;
      token = await this.auth();
      resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`ERP GET ${path} → HTTP ${resp.status}. ${txt.slice(0, 200)}`);
    }
    return resp.json();
  }
}

/** Mapa módulo (linguagem do agente) → rota(s) de leitura do ERP. */
const MODULOS: Record<string, string> = {
  dashboard: '/dashboard',
  vendas: '/pedidos',
  pedidos: '/pedidos',
  producao: '/ops',
  ops: '/ops',
  pcp: '/pcp/painel',
  pilotos: '/pilotos',
  estoque: '/estoque',
  materiais: '/materiais',
  materia: '/materiais',
  insumos: '/materiais',
  compras: '/ordens-compra',
  ordens_compra: '/ordens-compra',
  expedicao: '/expedicoes',
  expedicoes: '/expedicoes',
  clientes: '/clientes',
  fornecedores: '/fornecedores',
  produtos: '/produtos',
  receber: '/financeiro/receber',
  contas_receber: '/financeiro/receber',
  pagar: '/financeiro/pagar',
  contas_pagar: '/financeiro/pagar',
  fluxo: '/financeiro/fluxo',
  comissoes: '/financeiro/comissoes',
  impostos: '/financeiro/impostos',
  nfe: '/nfe',
  notas: '/nfe',
  logs: '/logs',
};

export const erp = new ErpClient();

export function modulosDisponiveis(): string[] {
  return Object.keys(MODULOS);
}

/** Resolve o módulo pedido pelo agente e retorna os dados de leitura do ERP. */
export async function consultarModulo(
  modulo: string,
  filtros?: Record<string, unknown>,
): Promise<unknown> {
  const chave = String(modulo || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const path = MODULOS[chave];
  if (!path) {
    return {
      erro: `Módulo "${modulo}" não reconhecido.`,
      modulos_validos: modulosDisponiveis(),
    };
  }
  return erp.get(path, filtros);
}
