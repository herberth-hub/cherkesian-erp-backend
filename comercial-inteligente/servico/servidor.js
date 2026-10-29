'use strict';

/**
 * Servidor HTTP do painel (Node puro, sem dependências).
 *
 * Autenticação: PAINEL_TOKEN. Abra /?token=<token> uma vez: vira cookie HttpOnly SameSite=Strict.
 * Toda chamada de API exige o cookie (ou Authorization: Bearer <token>); toda escrita exige
 * ainda o cabeçalho X-Painel: 1 (barra CSRF de outros sites).
 *
 * Quem decide pelo painel age como "humano" — é o único lugar onde aprovações na alçada
 * humana, respostas a escalonamentos ao humano e aprovação de metas gerais são feitas.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../src/comercial');
const PR = require('../src/protocolo');

const HTML = path.join(__dirname, 'painel.html');
const LIMITE_CORPO = 64 * 1024;

function iguais(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookie(req, nome) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > LIMITE_CORPO) {
        reject(new Error('Corpo da requisição grande demais.'));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => {
      try {
        resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

/** Visão da base para o painel: o que está aberto e o que espera o humano. */
function visaoBase(base) {
  const sols = base.listar('solicitacao');
  const abertas = sols.filter((s) => s.status !== 'concluida');
  return {
    ficticia: base.ficticia,
    politicaConfigurada: Boolean(base.politica().configurado),
    aprovacoes: base
      .listar('aprovacao')
      .filter((a) => a.status === 'pendente')
      .map((a) => {
        const prop = a.objetoTipo === 'proposta' ? base.obter('proposta', a.objetoId) : null;
        const av = prop && prop.avaliacao;
        return { id: a.id, objeto: `${a.objetoTipo} ${a.objetoId}`, alcada: a.alcadaNecessaria, solicitadoPor: a.solicitadoPor, motivos: a.motivos, valor: av ? av.valorTotal : null, margem: av && av.margem ? av.margem.percentual : null, desconto: av ? av.descontoPercent : null };
      }),
    paraHumano: abertas
      .filter((s) => (s.responsavel === 'humano' && ['pendente', 'em_andamento'].includes(s.status)) || (s.solicitante === 'humano' && s.status === 'aguardando_informacao'))
      .map((s) => ({ id: s.id, de: s.solicitante, para: s.responsavel, objetivo: s.objetivo, dados: s.dadosDisponiveis, prazo: s.prazo, status: s.status, ultima: s.respostas.length ? s.respostas[s.respostas.length - 1].texto : null })),
    solicitacoes: abertas.slice(-40).reverse().map((s) => ({ id: s.id, de: s.solicitante, para: s.responsavel, fluxo: s.fluxo, objetivo: s.objetivo, prazo: s.prazo, status: s.status })),
    tarefas: base.listar('tarefa').filter((t) => t.status !== 'concluida').slice(-40).reverse().map((t) => ({ id: t.id, titulo: t.titulo, de: t.atribuidaPor, para: t.responsavel, prazo: t.prazo, status: t.status })),
    metasPropostas: base.listar('meta').filter((m) => m.nivel === 'empresa' && m.status === 'proposta').map((m) => ({ id: m.id, periodo: m.periodo, faturamento: m.faturamento })),
  };
}

function criarServidor({ orquestrador, eventos, token }) {
  if (!token || token.length < 16) throw new Error('PAINEL_TOKEN ausente ou curto (mínimo 16 caracteres).');

  const autenticado = (req) => iguais(cookie(req, 'hc_painel'), token) || iguais(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), token);

  const rotasPost = {
    'POST /api/pausar': (c) => (orquestrador.pausar(c.papel || null), { ok: true }),
    'POST /api/retomar': (c) => (orquestrador.retomar(c.papel || null), { ok: true }),
    'POST /api/rotina': (c) => {
      const job = orquestrador.executarRotina(c.id);
      if (!job) throw Object.assign(new Error('Rotina inexistente ou já na fila.'), { status: 404 });
      orquestrador.despachar();
      return { ok: true, job: job.id };
    },
    'POST /api/aprovacao': (c) => {
      const base = orquestrador.abrirBase();
      const r = C.decidirAprovacao(base, 'humano', { id: c.id, decisao: c.decisao, justificativa: c.justificativa });
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `${c.id} ${c.decisao}: ${c.justificativa}` });
      return r;
    },
    'POST /api/solicitacao': (c) => {
      const base = orquestrador.abrirBase();
      const sol = base.exigir('solicitacao', c.id);
      const tipo = sol.solicitante === 'humano' && sol.status === 'aguardando_informacao' ? 'informacao' : 'decisao';
      const r = PR.responderSolicitacao(base, { agente: 'humano', id: c.id, tipo, texto: c.texto });
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `${c.id} (${tipo}): ${c.texto}` });
      orquestrador.coletarDaBase();
      orquestrador.despachar();
      return r;
    },
    'POST /api/meta': (c) => {
      const base = orquestrador.abrirBase();
      const r = C.atualizarMeta(base, 'humano', c.id, { status: c.aprovar ? 'aprovada' : 'revogada' });
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `Meta ${c.id} ${c.aprovar ? 'aprovada' : 'revogada'}` });
      return r;
    },
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://painel');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'GET' && url.pathname === '/saude') return json(res, 200, { ok: true });

    if (req.method === 'GET' && url.pathname === '/') {
      const q = url.searchParams.get('token');
      if (q && iguais(q, token)) {
        res.writeHead(302, { 'Set-Cookie': `hc_painel=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, Location: '/' });
        return res.end();
      }
      if (!autenticado(req)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Acesso negado. Abra o painel com /?token=<PAINEL_TOKEN>.');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'" });
      return res.end(fs.readFileSync(HTML));
    }

    if (!url.pathname.startsWith('/api/')) return json(res, 404, { erro: 'Não encontrado.' });
    if (!autenticado(req)) return json(res, 401, { erro: 'Não autenticado.' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/estado') {
        return json(res, 200, { ...orquestrador.estado(), dados: visaoBase(orquestrador.abrirBase()), eventos: eventos.recentes.slice(-120) });
      }
      if (req.method === 'GET' && url.pathname === '/api/eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': conectado\n\n');
        const enviar = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        eventos.on('evento', enviar);
        req.on('close', () => {
          clearInterval(ping);
          eventos.off('evento', enviar);
        });
        return undefined;
      }
      const rota = rotasPost[`${req.method} ${url.pathname}`];
      if (!rota) return json(res, 404, { erro: 'Rota inexistente.' });
      if (req.headers['x-painel'] !== '1') return json(res, 403, { erro: 'Cabeçalho X-Painel ausente.' });
      const corpo = await lerCorpo(req);
      return json(res, 200, await rota(corpo));
    } catch (e) {
      return json(res, e.status || (e.codigo ? 422 : 500), { erro: e.message, codigo: e.codigo || null });
    }
  });
}

module.exports = { criarServidor, visaoBase };
