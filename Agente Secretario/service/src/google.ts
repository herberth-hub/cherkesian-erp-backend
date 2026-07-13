import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { cfg } from './config';

/** Escopos mínimos: ler e-mails, enviar (fases futuras) e gerenciar eventos. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];

export function oauthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = cfg.google;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Salva o token (refresh_token) obtido no fluxo OAuth. */
export function salvarToken(tokens: Record<string, unknown>): void {
  writeFileSync(cfg.google.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
}

/** Retorna um cliente autenticado, ou null se o Google ainda não foi conectado. */
function clienteAutenticado(): OAuth2Client | null {
  const { clientId, clientSecret, tokenPath } = cfg.google;
  if (!clientId || !clientSecret) return null;
  if (!existsSync(tokenPath)) return null;
  try {
    const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const client = oauthClient();
    client.setCredentials(tokens);
    return client;
  } catch {
    return null;
  }
}

const AVISO_NAO_CONECTADO = {
  conectado: false,
  aviso:
    'Google (Gmail/Calendar) ainda não conectado. Rode `npm run auth:google` e siga o link de consentimento. Na Fase 1, os briefings seguem só com os dados do ERP.',
};

/** Constrói o filtro `q` do Gmail a partir da linguagem do agente. */
function gmailQuery(filtro?: string, periodo?: string): string {
  const partes: string[] = [];
  const f = (filtro || '').toLowerCase();
  if (f.includes('nao lid') || f.includes('não lid') || f.includes('unread')) partes.push('is:unread');
  if (f.includes('urgent')) partes.push('(is:important OR is:starred)');
  const de = /de:([^\s]+)/.exec(filtro || '');
  if (de) partes.push(`from:${de[1]}`);
  const p = (periodo || '').toLowerCase();
  if (p.includes('hoje') || p.includes('24h') || p.includes('24 h')) partes.push('newer_than:1d');
  else if (p.includes('semana')) partes.push('newer_than:7d');
  else if (/^\d{4}-\d{2}-\d{2}$/.test(periodo || '')) partes.push(`after:${(periodo || '').replace(/-/g, '/')}`);
  return partes.join(' ') || 'newer_than:1d';
}

function header(headers: Array<{ name?: string | null; value?: string | null }> | undefined, nome: string): string {
  return headers?.find((h) => (h.name || '').toLowerCase() === nome.toLowerCase())?.value || '';
}

/** Lê e resume e-mails (somente leitura). */
export async function lerEmails(filtro?: string, periodo?: string, max = 12): Promise<unknown> {
  const client = clienteAutenticado();
  if (!client) return AVISO_NAO_CONECTADO;
  const gmail = google.gmail({ version: 'v1', auth: client });
  const q = gmailQuery(filtro, periodo);
  const lista = await gmail.users.messages.list({ userId: 'me', q, maxResults: max });
  const ids = (lista.data.messages || []).map((m) => m.id!).filter(Boolean);
  const emails = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const h = msg.data.payload?.headers || undefined;
    emails.push({
      de: header(h, 'From'),
      assunto: header(h, 'Subject'),
      data: header(h, 'Date'),
      resumo: msg.data.snippet || '',
      nao_lido: (msg.data.labelIds || []).includes('UNREAD'),
    });
  }
  return { conectado: true, filtro_aplicado: q, quantidade: emails.length, emails };
}

/** Lê eventos do Google Calendar no período. */
export async function lerAgenda(periodo: string): Promise<unknown> {
  const client = clienteAutenticado();
  if (!client) return AVISO_NAO_CONECTADO;
  const calendar = google.calendar({ version: 'v3', auth: client });

  const agora = new Date();
  const inicio = new Date(agora);
  const fim = new Date(agora);
  const p = (periodo || '').toLowerCase();
  if (p.includes('semana')) fim.setDate(fim.getDate() + 7);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(periodo)) {
    inicio.setTime(new Date(periodo + 'T00:00:00').getTime());
    fim.setTime(new Date(periodo + 'T23:59:59').getTime());
  } else {
    // "hoje" (padrão): do início ao fim do dia atual
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 0);
  }

  const resp = await calendar.events.list({
    calendarId: 'primary',
    timeMin: inicio.toISOString(),
    timeMax: fim.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 30,
  });
  const eventos = (resp.data.items || []).map((e) => ({
    titulo: e.summary || '(sem título)',
    inicio: e.start?.dateTime || e.start?.date || '',
    fim: e.end?.dateTime || e.end?.date || '',
    local: e.location || '',
    participantes: (e.attendees || []).map((a) => a.email).filter(Boolean),
  }));
  return { conectado: true, periodo, quantidade: eventos.length, eventos };
}
