'use strict';

/**
 * Cliente mínimo da API do Gmail (REST + OAuth2 com refresh token), sem dependências.
 * Escopos usados: gmail.readonly (ler) e gmail.compose (criar RASCUNHOS).
 * O código só cria rascunhos — não existe função de envio aqui. (O Google não oferece um
 * escopo "só rascunho": gmail.compose também permitiria enviar; a garantia é este código.)
 */

const ESCOPOS = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Texto simples a partir de HTML (para e-mails sem parte text/plain). */
function htmlParaTexto(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Percorre as partes MIME: corpo em texto e lista de anexos. */
function extrairPartes(payload) {
  let texto = '';
  let html = '';
  const anexos = [];
  const visitar = (p) => {
    if (!p) return;
    const mime = p.mimeType || '';
    if (p.filename && p.body && (p.body.attachmentId || p.body.data)) {
      anexos.push({ nome: p.filename, mime, tamanho: p.body.size || 0, attachmentId: p.body.attachmentId || null, dados: p.body.data || null });
    } else if (mime === 'text/plain' && p.body && p.body.data) {
      texto += deB64url(p.body.data).toString('utf8');
    } else if (mime === 'text/html' && p.body && p.body.data) {
      html += deB64url(p.body.data).toString('utf8');
    }
    (p.parts || []).forEach(visitar);
  };
  visitar(payload);
  return { texto: (texto || htmlParaTexto(html)).trim(), anexos };
}

/** Assunto codificado em UTF-8 (RFC 2047) para acentos. */
const cabecalhoUtf8 = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

/** Mensagem RFC 2822 de resposta (rascunho), em texto puro UTF-8. */
function montarResposta({ de, para, assunto, corpo, inReplyTo, references }) {
  const linhas = [
    `From: ${de}`,
    `To: ${para}`,
    `Subject: ${cabecalhoUtf8(/^re:/i.test(assunto) ? assunto : `Re: ${assunto}`)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (inReplyTo) {
    linhas.push(`In-Reply-To: ${inReplyTo}`);
    linhas.push(`References: ${references ? `${references} ${inReplyTo}` : inReplyTo}`);
  }
  const corpoB64 = Buffer.from(corpo, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return `${linhas.join('\r\n')}\r\n\r\n${corpoB64}`;
}

class CaixaGmail {
  constructor({ conta, clientId, clientSecret, refreshToken, fetchImpl = globalThis.fetch }) {
    this.conta = conta;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.fetch = fetchImpl;
    this.acesso = null;
    this.expira = 0;
  }

  async token() {
    if (this.acesso && Date.now() < this.expira - 60000) return this.acesso;
    const r = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error(`Gmail (${this.conta}): falha ao renovar acesso (HTTP ${r.status} ${d.error || ''}). Reconecte a conta pelo painel.`);
    this.acesso = d.access_token;
    this.expira = Date.now() + (d.expires_in || 3600) * 1000;
    return this.acesso;
  }

  async chamar(caminho, opcoes = {}) {
    const r = await this.fetch(`${API}${caminho}`, { ...opcoes, headers: { Authorization: `Bearer ${await this.token()}`, ...(opcoes.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gmail (${this.conta}) ${caminho.split('?')[0]} → HTTP ${r.status} ${(d.error && d.error.message) || ''}`);
    return d;
  }

  async listar(consulta, max = 20) {
    const d = await this.chamar(`/messages?${new URLSearchParams({ q: consulta, maxResults: String(max) })}`);
    return (d.messages || []).map((m) => m.id);
  }

  async obter(id) {
    const m = await this.chamar(`/messages/${encodeURIComponent(id)}?format=full`);
    const cab = Object.fromEntries((m.payload.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const { texto, anexos } = extrairPartes(m.payload);
    return {
      id: m.id,
      threadId: m.threadId,
      conta: this.conta,
      de: cab.from || '',
      responderPara: cab['reply-to'] || cab.from || '',
      para: cab.to || '',
      assunto: cab.subject || '(sem assunto)',
      data: cab.date || '',
      messageId: cab['message-id'] || null,
      references: cab.references || null,
      texto,
      anexos,
    };
  }

  async anexo(msgId, anexo) {
    if (anexo.dados) return deB64url(anexo.dados);
    const d = await this.chamar(`/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(anexo.attachmentId)}`);
    return deB64url(d.data);
  }

  /** Cria um RASCUNHO de resposta no mesmo fio. Não envia. */
  async criarRascunho(email, corpo) {
    const raw = montarResposta({ de: this.conta, para: email.responderPara, assunto: email.assunto, corpo, inReplyTo: email.messageId, references: email.references });
    const d = await this.chamar('/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: b64url(raw), threadId: email.threadId } }),
    });
    return { id: d.id, link: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(this.conta)}#drafts` };
  }

  async perfil() {
    return this.chamar('/profile');
  }
}

module.exports = { CaixaGmail, ESCOPOS, extrairPartes, montarResposta, htmlParaTexto, b64url, deB64url, TOKEN_URL };
