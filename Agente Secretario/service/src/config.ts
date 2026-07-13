import 'dotenv/config';

/** Configuração central do Agente Secretário — tudo por variável de ambiente. */
export const cfg = {
  // IA (Claude)
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.AGENT_MODEL || 'claude-opus-4-8',

  // ERP Cherkesian (API REST já implantada)
  erpBaseUrl: (process.env.ERP_API_URL || 'https://cherkesian-erp-backend.onrender.com/api/v1').replace(/\/$/, ''),
  erpUser: process.env.ERP_USER || 'agente',
  erpSenha: process.env.ERP_SENHA || '',

  // Google Workspace (Gmail + Calendar) — opcional na Fase 1
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5555/oauth2callback',
    tokenPath: process.env.GOOGLE_TOKEN_PATH || 'token.google.json',
  },

  timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
  diretor: {
    nome: process.env.DIRETOR_NOME || 'Herberth Cherkesian',
    email: process.env.DIRETOR_EMAIL || 'contato@hcqualitycorp.com.br',
  },
} as const;

export function exigirIA(): void {
  if (!cfg.anthropicKey) {
    throw new Error(
      'ANTHROPIC_API_KEY não definida. Crie o arquivo .env (veja .env.example) com a chave da Claude API.',
    );
  }
}
