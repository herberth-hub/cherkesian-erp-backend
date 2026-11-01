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
const { assinaturaMetaValida } = require('./whatsapp');
const { salvarPolitica } = require('../src/politica');
const PR = require('../src/protocolo');

const HTML = path.join(__dirname, 'painel.html');
const LIMITE_CORPO = 64 * 1024;
/** A Meta agrupa vários eventos por POST: o webhook aceita corpos maiores (até ~3 MB pela documentação). */
const LIMITE_WEBHOOK = 5 * 1024 * 1024;

function iguais(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookie(req, nome) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null; // cookie malformado: trata como ausente (nunca derruba o servidor)
  }
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

function lerBruto(req, limite = LIMITE_CORPO) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) {
        reject(new Error('Corpo grande demais.'));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/** Primeira frase de um texto, cortada em `max` caracteres. */
function primeiraFrase(texto, max = 110) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  // Fim da frase: . ! ? seguido de espaço, fora de parênteses.
  let f = t;
  for (let i = 0, nivel = 0; i < t.length; i++) {
    if (t[i] === '(') nivel++;
    else if (t[i] === ')') nivel = Math.max(0, nivel - 1);
    else if (!nivel && '.!?'.includes(t[i]) && (i === t.length - 1 || t[i + 1] === ' ')) { f = t.slice(0, i + 1); break; }
  }
  return f.length > max ? `${f.slice(0, max - 1).trimEnd()}…` : f;
}

/** Alternativas que o agente listou como "(A) participar ... (B) declinar". */
function extrairOpcoes(texto) {
  const out = [];
  const re = /\(([A-E])\)\s*([^;\n(]{3,90}?)(?=\s*(?:[;\n]|\([A-E]\)|\.\s|$))/g;
  let m;
  while ((m = re.exec(String(texto || ''))) && out.length < 4) {
    if (!out.some((o) => o.letra === m[1])) out.push({ letra: m[1], texto: m[2].trim().replace(/[,.:]$/, '') });
  }
  return out;
}

/** Recomendação do agente, se ele escreveu uma ("Recomendo…", "Recomendação: …"). */
function extrairRecomendacao(texto) {
  const m = String(texto || '').replace(/\s+/g, ' ').match(/(recomend[^.:]*[:.]?\s*[^.]+\.)/i);
  return m ? primeiraFrase(m[1], 220) : null;
}

/**
 * Casos para o humano: cada solicitação que chegou até ele vira UM caso, com a cadeia
 * (vendedor → gerente → diretor → CEO → você) resumida em uma linha por salto.
 */
function casosParaHumano(sols, paraHumano, hoje) {
  const porId = new Map(sols.map((s) => [s.id, s]));
  return paraHumano.map((s) => {
    const cadeia = [];
    for (let atual = s, i = 0; atual && i < 10; atual = porId.get(atual.origemId), i++) cadeia.unshift(atual);
    const textoCompleto = [s.objetivo, s.dadosDisponiveis, ...(s.respostas || []).map((r) => r.texto)].filter(Boolean).join('\n\n');
    const raiz = cadeia[0];
    const urgente = Boolean(s.prazo && s.prazo <= hoje);
    return {
      id: s.id,
      raizId: s.raizId || raiz.id,
      titulo: primeiraFrase(s.objetivo, 120),
      prazo: s.prazo || null,
      urgente,
      pedidoInformacao: s.solicitante === 'humano' && s.status === 'aguardando_informacao',
      de: s.solicitante,
      recomendacao: extrairRecomendacao(textoCompleto),
      opcoes: extrairOpcoes(textoCompleto),
      fatos: [
        { k: 'Começou com', v: raiz.solicitante },
        { k: 'Prazo', v: s.prazo || 'sem prazo' },
        { k: 'Saltos', v: String(cadeia.length) },
      ],
      cadeia: cadeia.map((c) => ({ id: c.id, de: c.solicitante, para: c.responsavel, resumo: primeiraFrase(c.objetivo, 140) })),
      textoCompleto: textoCompleto.slice(0, 6000),
    };
  });
}

/** Funil em 5 colunas com contagem e oportunidades paradas há mais de 5 dias. */
const GRUPOS_FUNIL = [
  ['Lead', ['lead_identificado', 'lead_qualificado', 'contato_realizado']],
  ['Qualificado', ['necessidade_levantada']],
  ['Cotação', ['cotacao_solicitada', 'proposta_em_preparacao']],
  ['Proposta', ['proposta_enviada', 'negociacao', 'aguardando_decisao']],
  ['Fechado', ['pedido_ganho', 'pos_venda']],
];
function resumoFunil(oportunidades, agoraMs = Date.now()) {
  return GRUPOS_FUNIL.map(([nome, etapas]) => {
    const itens = oportunidades.filter((o) => etapas.includes(o.etapa));
    const paradas = nome === 'Fechado' ? 0 : itens.filter((o) => agoraMs - new Date(o.atualizadoEm || o.criadoEm || 0).getTime() > 5 * 86400000).length;
    return { nome, total: itens.length, paradas };
  });
}

/** Quadro do funil: oportunidades abertas e ganhas nos últimos 30 dias, por coluna. */
function quadroFunil(base, agoraMs = Date.now()) {
  const clientes = new Map(base.listar('cliente').map((c) => [c.id, c.nomeFantasia || c.razaoSocial]));
  const leads = new Map(base.listar('lead').map((l) => [l.id, l.empresa]));
  const agentes = new Map(base.listar('agente').map((a) => [a.id, a.nome]));
  const coluna = (etapa) => (GRUPOS_FUNIL.find(([, etapas]) => etapas.includes(etapa)) || [null])[0];
  const cartoes = base
    .listar('oportunidade')
    .map((o) => {
      const col = coluna(o.etapa);
      if (!col) return null;
      const idade = Math.max(0, Math.floor((agoraMs - new Date(o.atualizadoEm || o.criadoEm).getTime()) / 86400000));
      if (col === 'Fechado' && idade > 30) return null;
      return {
        id: o.id,
        titulo: o.titulo,
        cliente: clientes.get(o.clienteId) || leads.get(o.leadId) || '—',
        responsavel: agentes.get(o.responsavelId) || o.responsavelId,
        valorEstimado: o.valorEstimado,
        etapa: o.etapa,
        coluna: col,
        idadeDias: idade,
        parada: col !== 'Fechado' && idade > 5,
        proximoPasso: o.proximoPasso || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.idadeDias - a.idadeDias);
  return { colunas: GRUPOS_FUNIL.map(([nome, etapas]) => ({ nome, etapas })), cartoes };
}

/** Atividade do dia para o "rever o dia": trabalhos (início/fim), decisões e escalonamentos de hoje. */
function atividadeDoDia(base, dir, hoje, fuso = 'America/Sao_Paulo') {
  const dataLocal = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(iso));
  const eventos = [];
  try {
    const arq = path.join(dir, 'logs', 'atividade.jsonl');
    const tam = fs.statSync(arq).size;
    const fd = fs.openSync(arq, 'r');
    const ler = Math.min(tam, 4 * 1024 * 1024); // só o fim do arquivo: o dia de hoje
    const buf = Buffer.alloc(ler);
    fs.readSync(fd, buf, 0, ler, tam - ler);
    fs.closeSync(fd);
    for (const linha of buf.toString('utf8').split('\n')) {
      if (!linha.startsWith('{')) continue;
      let ev;
      try { ev = JSON.parse(linha); } catch { continue; }
      if (!['inicio', 'fim', 'decisao-humana', 'alerta', 'rascunho'].includes(ev.tipo) || dataLocal(ev.em) !== hoje) continue;
      eventos.push({ em: ev.em, tipo: ev.tipo, papel: ev.papel, titulo: ev.titulo || ev.texto || null, status: ev.status || null, job: ev.job || null });
    }
  } catch {
    // sem log ainda: dia vazio
  }
  const solicitacoes = base
    .listar('solicitacao')
    .filter((s) => s.criadoEm && dataLocal(s.criadoEm) === hoje)
    .map((s) => ({ em: s.criadoEm, id: s.id, de: s.solicitante, para: s.responsavel, fluxo: s.fluxo, resumo: primeiraFrase(s.objetivo, 100) }));
  return { hoje, eventos, solicitacoes };
}

/** Visão da base para o painel: o que está aberto e o que espera o humano. */
function visaoBase(base, hoje = new Date().toISOString().slice(0, 10)) {
  const sols = base.listar('solicitacao');
  const abertas = sols.filter((s) => s.status !== 'concluida');
  const paraHumanoSols = abertas.filter((s) => (s.responsavel === 'humano' && ['pendente', 'em_andamento'].includes(s.status)) || (s.solicitante === 'humano' && s.status === 'aguardando_informacao'));
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
    casos: casosParaHumano(sols, paraHumanoSols, hoje),
    funil: resumoFunil(base.listar('oportunidade')),
    paraHumano: paraHumanoSols
      .map((s) => ({ id: s.id, de: s.solicitante, para: s.responsavel, objetivo: s.objetivo, dados: s.dadosDisponiveis, prazo: s.prazo, status: s.status, ultima: s.respostas.length ? s.respostas[s.respostas.length - 1].texto : null })),
    solicitacoes: abertas.slice(-40).reverse().map((s) => ({ id: s.id, de: s.solicitante, para: s.responsavel, fluxo: s.fluxo, objetivo: s.objetivo, prazo: s.prazo, status: s.status })),
    tarefas: base.listar('tarefa').filter((t) => t.status !== 'concluida').slice(-40).reverse().map((t) => ({ id: t.id, titulo: t.titulo, de: t.atribuidaPor, para: t.responsavel, prazo: t.prazo, status: t.status })),
    metasPropostas: base.listar('meta').filter((m) => m.nivel === 'empresa' && m.status === 'proposta').map((m) => ({ id: m.id, periodo: m.periodo, faturamento: m.faturamento })),
  };
}

function paginaSimples(res, status, titulo, texto) {
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>` +
    `<body style="font:16px system-ui;margin:0;padding:32px 16px;background:#f4f5f7;color:#1c2430"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e2e5ea;border-radius:12px;padding:20px">` +
    `<h2 style="margin-top:0">${esc(titulo)}</h2><p>${esc(texto)}</p><p><a href="/">Voltar ao painel</a></p></div></body>`);
}

/** Configuração para a área "Configurar" do painel (nada de segredo sai daqui). */
function visaoConfig(base, env = process.env) {
  const { _arquivo, ...politica } = base.politica();
  let erpHost = null;
  try {
    erpHost = env.ERP_API_URL ? new URL(env.ERP_API_URL).host : null;
  } catch {
    erpHost = 'endereço inválido';
  }
  const problemas = base.auditar();
  return {
    base: base.ficticia ? 'demo' : 'producao',
    politica,
    politicaArquivo: _arquivo,
    agentes: base.listar('agente').map((a) => ({ id: a.id, nome: a.nome, papel: a.papel, tipo: a.tipo, ativo: a.ativo, email: a.email || null })),
    erp: { configurado: Boolean(env.ERP_API_URL && env.ERP_USUARIO && env.ERP_SENHA), host: erpHost, permitido: !base.ficticia },
    contagem: Object.fromEntries(['cliente', 'produto', 'pedido', 'lead', 'oportunidade'].map((e) => [e, base.listar(e).length])),
    saude: { ok: problemas.length === 0, problemas: problemas.slice(0, 10).map((x) => `${x.entidade} ${x.id}: ${x.erros[0]}`) },
  };
}

/** Tela de entrada: campo para colar a senha do painel (PAINEL_TOKEN). */
function paginaEntrada(res, erro) {
  res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Diretoria Comercial</title>
<style>
:root{--bg:#f4f5f7;--painel:#fff;--borda:#e2e5ea;--texto:#1c2430;--suave:#5f6b7a;--marca:#0f5c8c;--erro:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#0f1419;--painel:#171d24;--borda:#27313c;--texto:#e6ebf1;--suave:#a3afbd;--marca:#4aa3df;--erro:#ef6b5b}}
body{margin:0;background:var(--bg);color:var(--texto);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;margin:12vh auto 0;padding:0 16px}
.card{background:var(--painel);border:1px solid var(--borda);border-radius:14px;padding:22px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--suave);font-size:14px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;font:inherit;padding:11px 12px;border:1px solid var(--borda);border-radius:10px;background:var(--bg);color:var(--texto)}
button{margin-top:12px;width:100%;font:inherit;font-weight:600;padding:11px;border:0;border-radius:10px;background:var(--marca);color:#fff}
.erro{color:var(--erro);font-size:14px;margin:0 0 12px}
</style>
<main><div class="card"><h1>Diretoria Comercial de IA</h1><p>HC Quality · cole a senha do painel (PAINEL_TOKEN, no Render → Environment).</p>
${erro ? `<p class="erro">${erro.replace(/[&<>"']/g, '')}</p>` : ''}
<form method="post" action="/entrar"><input name="senha" type="password" autocomplete="current-password" placeholder="Senha do painel" required autofocus><button type="submit">Entrar</button></form></div></main></html>`);
}

function criarServidor({ orquestrador, eventos, token, erpCliente = null, env = process.env }) {
  if (!token || token.length < 16) throw new Error('PAINEL_TOKEN ausente ou curto (mínimo 16 caracteres).');
  const estadosOAuth = new Map(); // state -> { conta, expira }

  const exigirWhatsapp = () => {
    if (!orquestrador.whatsapp) throw Object.assign(new Error('WhatsApp não habilitado neste serviço.'), { status: 404 });
    return orquestrador.whatsapp;
  };

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
    'POST /api/whatsapp/aprovar': async (c) => {
      const w = exigirWhatsapp();
      const p = await w.aprovar(c.id, c.texto);
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `WhatsApp ${p.id} aprovado e enviado` });
      return p;
    },
    'POST /api/whatsapp/descartar': (c) => exigirWhatsapp().descartar(c.id),
    'POST /api/whatsapp/assumir': (c) => {
      const conv = exigirWhatsapp().assumir(c.telefone, Boolean(c.assumir));
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `Conversa ${conv.nome || conv.telefone.slice(-4)} ${c.assumir ? 'assumida por você' : 'devolvida ao agente'}` });
      return { telefone: conv.telefone, estado: conv.estado };
    },
    'POST /api/whatsapp/responder': async (c) => {
      // Escrever pelo painel = assumir a conversa (o agente para de responder até você devolver).
      const w = exigirWhatsapp();
      const texto = String(c.texto || '').trim();
      if (!texto) throw Object.assign(new Error('Escreva a mensagem.'), { status: 422 });
      await w.enviarTexto(c.telefone, texto, 'humano');
      w.assumir(c.telefone, true); // só depois do envio: se falhar, a conversa continua como estava
      return { ok: true };
    },
    'POST /api/politica': (c) => {
      const base = orquestrador.abrirBase();
      const r = salvarPolitica(base, c.politica);
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `Política comercial ${r.configurado ? 'ativada' : 'salva (não ativa)'}` });
      return r;
    },
    'POST /api/agentes': (c) => {
      const base = orquestrador.abrirBase();
      const r = C.registrar(base, 'humano', 'agente', {
        nome: String(c.nome || '').trim(),
        papel: c.papel,
        tipo: c.tipo,
        email: c.email ? String(c.email).trim() : null,
        superiorId: null,
        ativo: true,
      });
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `Cadastrado ${r.nome} (${r.papel})` });
      return r;
    },
    'POST /api/agentes/ativo': (c) => C.atualizar(orquestrador.abrirBase(), 'humano', 'agente', c.id, { ativo: Boolean(c.ativo) }),
    'POST /api/erp/importar': async (c) => {
      const base = orquestrador.abrirBase();
      if (base.ficticia) throw Object.assign(new Error('A importação do ERP só funciona na base de produção (HC_BASE=producao).'), { status: 422 });
      const { importar } = require('../integracoes/erp');
      let resumo;
      try {
        resumo = await importar(base, c.recurso, { responsavelPadraoId: c.responsavel || undefined, cliente: erpCliente || undefined });
      } catch (e) {
        throw Object.assign(e, { status: e.status || 422 });
      }
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `Importação do ERP (${c.recurso}): ${resumo.criados} novos, ${resumo.atualizados} atualizados, ${resumo.erros.length} com erro` });
      // O vendedor escolhido na importação manual de leads vira o padrão da importação automática.
      if (c.recurso === 'leads' && c.responsavel && orquestrador.sincronizacao) orquestrador.sincronizacao.definirResponsavel(c.responsavel);
      return resumo;
    },
    'POST /api/erp/sincronizar': async () => {
      if (!orquestrador.sincronizacao) throw Object.assign(new Error('Importação automática não habilitada neste serviço.'), { status: 404 });
      return orquestrador.sincronizacao.executar('manual');
    },
    'POST /api/contas/atribuir': (c) => {
      const r = require('../src/contas').atribuir(orquestrador.abrirBase(), 'humano', { grupoId: c.grupo || undefined, unidadeId: c.unidade || undefined, responsavelId: c.responsavel, papel: c.como });
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `${r.id}: responsável definido (${c.como === 'corporativo' ? 'corporativo' : c.unidade ? 'unidade' : 'grupo'})` });
      return r;
    },
    'POST /api/oportunidade/etapa': (c) => {
      // Mover no quadro: vai para a primeira etapa da coluna escolhida (decisão humana registrada no histórico).
      const grupo = GRUPOS_FUNIL.find(([nome]) => nome === c.coluna);
      if (!grupo) throw Object.assign(new Error('Coluna inválida.'), { status: 422 });
      const base = orquestrador.abrirBase();
      const atual = base.exigir('oportunidade', c.id);
      if (grupo[1].includes(atual.etapa)) return atual;
      const patch = { etapa: grupo[1][0] };
      if (patch.etapa === 'pedido_ganho') patch.fechadoEm = orquestrador.dataLocal();
      const r = C.atualizar(base, 'humano', 'oportunidade', c.id, patch);
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `${c.id} movida para ${c.coluna}` });
      return r;
    },
    'POST /api/agentes/mensagem': (c) => orquestrador.enviarOrdem(c.papel, c.texto),
    'POST /api/hunter/fora-expediente': (c) => orquestrador.liberarHunter(Boolean(c.liberar)),
    'POST /api/meta': (c) => {
      const base = orquestrador.abrirBase();
      const r = C.atualizarMeta(base, 'humano', c.id, { status: c.aprovar ? 'aprovada' : 'revogada' });
      eventos.emitir('decisao-humana', { papel: 'humano', texto: `Meta ${c.id} ${c.aprovar ? 'aprovada' : 'revogada'}` });
      return r;
    },
  };

  const atender = async (req, res) => {
    const url = new URL(req.url, 'http://painel');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'GET' && url.pathname === '/saude') return json(res, 200, { ok: true });

    // Entrada no painel: formulário com a senha (POST /entrar) ou link com ?token=.
    // Cookie SameSite=Lax: é enviado quando o painel é aberto a partir de outro site (ex.: link no Render);
    // as escritas continuam protegidas contra CSRF pelo cabeçalho X-Painel.
    const entrar = () => {
      res.writeHead(303, { 'Set-Cookie': `hc_painel=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`, Location: '/' });
      return res.end();
    };
    if (req.method === 'POST' && url.pathname === '/entrar') {
      let senha = '';
      try {
        senha = new URLSearchParams((await lerBruto(req)).toString('utf8')).get('senha') || '';
      } catch {
        senha = '';
      }
      if (iguais(senha.trim(), token)) return entrar();
      await new Promise((r) => setTimeout(r, 400)); // freia tentativas em série
      return paginaEntrada(res, 'Senha incorreta. Copie de novo o PAINEL_TOKEN no Render (Environment) e cole aqui.');
    }
    if (req.method === 'GET' && url.pathname === '/') {
      // Tokens gerados pelo Render são base64 e podem ter "+", que na URL vira espaço: restaura antes de comparar.
      const q = (url.searchParams.get('token') || '').trim().replace(/ /g, '+');
      if (q && iguais(q, token)) return entrar();
      if (!autenticado(req)) return paginaEntrada(res, q ? 'Senha do link incorreta.' : null);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'" });
      return res.end(fs.readFileSync(HTML));
    }

    // Webhook do WhatsApp (fase 3) — público, autenticado pelo provedor:
    // Meta: verificação do GET com verify token e assinatura HMAC do POST; Z-API: segredo na URL.
    if (url.pathname === '/webhook/whatsapp') {
      const w = orquestrador.whatsapp;
      if (!w || !w.configurado()) return json(res, 404, { erro: 'WhatsApp não configurado.' });
      const { provedor, meta, zapi } = w.cfg;
      if (req.method === 'GET') {
        const ok = provedor === 'meta' && url.searchParams.get('hub.mode') === 'subscribe' && iguais(url.searchParams.get('hub.verify_token'), meta.verifyToken);
        res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
        return res.end(ok ? String(url.searchParams.get('hub.challenge') || '') : 'Forbidden');
      }
      if (req.method !== 'POST') return json(res, 405, { erro: 'Método não permitido.' });
      let bruto;
      try {
        bruto = await lerBruto(req, LIMITE_WEBHOOK);
      } catch {
        return json(res, 413, { erro: 'Corpo grande demais.' });
      }
      const autorizado = provedor === 'meta' ? assinaturaMetaValida(bruto, req.headers['x-hub-signature-256'], meta.appSecret) : iguais(url.searchParams.get('segredo'), zapi.segredoWebhook);
      if (!autorizado) return json(res, 401, { erro: 'Assinatura inválida.' });
      try {
        await w.receber(JSON.parse(bruto.toString('utf8') || '{}'), { dentroDoExpediente: orquestrador.expediente() });
      } catch (e) {
        eventos.emitir('alerta', { papel: 'vendedor', texto: `Webhook do WhatsApp: ${e.message}` });
      }
      return json(res, 200, { recebido: true }); // 200 sempre, para o provedor não reenviar em loop
    }

    // Conexão do Gmail (fase 2). O início exige o painel autenticado; o retorno do Google é
    // validado pelo "state" aleatório de uso único (o cookie SameSite=Strict não volta do Google).
    if (req.method === 'GET' && url.pathname === '/oauth/gmail') {
      if (!autenticado(req)) return paginaSimples(res, 401, 'Acesso negado', 'Abra o painel com o token antes de conectar o Gmail.');
      const leitor = orquestrador.leitorEmail;
      try {
        if (!leitor) throw new Error('Leitor de e-mail não habilitado neste serviço.');
        const conta = String(url.searchParams.get('conta') || '').toLowerCase();
        const state = crypto.randomBytes(24).toString('hex');
        const destino = leitor.urlConsentimento(conta, state);
        estadosOAuth.set(state, { conta, expira: Date.now() + 10 * 60000 });
        res.writeHead(302, { Location: destino });
        return res.end();
      } catch (e) {
        return paginaSimples(res, 400, 'Não foi possível conectar', e.message);
      }
    }
    if (req.method === 'GET' && url.pathname === '/oauth/gmail/retorno') {
      const state = url.searchParams.get('state') || '';
      const pedido = estadosOAuth.get(state);
      estadosOAuth.delete(state);
      if (!pedido || pedido.expira < Date.now()) return paginaSimples(res, 400, 'Link expirado', 'Inicie a conexão de novo pelo painel.');
      if (url.searchParams.get('error')) return paginaSimples(res, 400, 'Autorização cancelada', 'Nenhuma permissão foi concedida.');
      try {
        await orquestrador.leitorEmail.concluirOAuth(pedido.conta, url.searchParams.get('code'));
        return paginaSimples(res, 200, 'Caixa conectada', `${pedido.conta} conectada. O vendedor começa a ler os e-mails no próximo ciclo dentro do expediente.`);
      } catch (e) {
        return paginaSimples(res, 400, 'Não foi possível conectar', e.message);
      }
    }

    if (!url.pathname.startsWith('/api/')) return json(res, 404, { erro: 'Não encontrado.' });
    if (!autenticado(req)) return json(res, 401, { erro: 'Não autenticado.' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/estado') {
        return json(res, 200, { ...orquestrador.estado(), dados: visaoBase(orquestrador.abrirBase(), orquestrador.dataLocal()), eventos: eventos.recentes.slice(-120) });
      }
      if (req.method === 'GET' && url.pathname === '/api/agentes/conversa') return json(res, 200, { papel: url.searchParams.get('papel'), mensagens: orquestrador.conversa(url.searchParams.get('papel')) });
      if (req.method === 'GET' && url.pathname === '/api/pipeline') return json(res, 200, quadroFunil(orquestrador.abrirBase()));
      if (req.method === 'GET' && url.pathname === '/api/dia') {
        const base = orquestrador.abrirBase();
        return json(res, 200, atividadeDoDia(base, base.dir, orquestrador.dataLocal(), orquestrador.cfg.fuso));
      }
      if (req.method === 'GET' && url.pathname === '/api/contas') {
        const K = require('../src/contas');
        const base = orquestrador.abrirBase();
        const grupo = url.searchParams.get('grupo');
        const vendedores = base.listar('agente').filter((a) => a.ativo && ['vendedor', 'gerente', 'diretor'].includes(a.papel)).map((a) => ({ id: a.id, nome: a.nome, papel: a.papel }));
        return json(res, 200, grupo ? { arvore: K.arvoreGrupo(base, grupo), vendedores } : { ...K.painelContas(base), vendedores });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const vc = visaoConfig(orquestrador.abrirBase(), env);
        vc.erp.sincronizacao = orquestrador.sincronizacao ? orquestrador.sincronizacao.estado() : null;
        return json(res, 200, vc);
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
  };

  // Rede de segurança: nenhuma requisição malformada (URL, cabeçalho, corpo) derruba o processo.
  return http.createServer((req, res) => {
    atender(req, res).catch((e) => {
      try {
        if (!res.headersSent) json(res, 400, { erro: 'Requisição inválida.' });
        else res.end();
      } catch {
        // conexão já encerrada
      }
      if (!(e instanceof URIError || e instanceof TypeError)) console.error('Erro não tratado no painel:', e);
    });
  });
}

module.exports = { criarServidor, visaoBase, visaoConfig, extrairOpcoes, primeiraFrase, quadroFunil, atividadeDoDia };
