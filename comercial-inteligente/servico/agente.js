'use strict';

/**
 * Execução de um trabalho por um agente.
 *  - modo "claude": loop de tool use com a API do Claude (SDK oficial). Entre iterações o
 *    agente verifica pausa/fim de expediente/orçamento e para de forma limpa.
 *  - modo "simulado": executa os comandos fixos da rotina, sem IA (demonstração e testes do painel).
 * Cada chamada de ferramenta e cada nota do agente vira evento no painel.
 */

const fs = require('fs');
const path = require('path');
const { DEFINICAO, executarHc } = require('./ferramentas');
const H = require('../src/hierarquia');

const RAIZ = path.resolve(__dirname, '..');
/** Ferramenta extra do vendedor: rascunho de resposta ao e-mail do trabalho (nunca envia). */
const RASCUNHO = {
  name: 'rascunho_email',
  description:
    'Cria um RASCUNHO de resposta ao e-mail deste trabalho, na mesma conversa do Gmail e para o remetente original ' +
    '(destinatário definido pelo servidor). Não envia: o responsável humano revisa e envia. Use no máximo uma vez por e-mail. ' +
    'Texto puro em português. Sem preços fora da tabela autorizada, sem prometer prazo, estoque ou certificação.',
  input_schema: {
    type: 'object',
    properties: { corpo: { type: 'string', description: 'Texto completo da resposta, já com saudação e assinatura.' } },
    required: ['corpo'],
    additionalProperties: false,
  },
  strict: true,
};
const LIMITE_RASCUNHO = 8000;

const resumir = (s, n = 400) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/** Prompt de sistema estável por papel (vai para o cache de prompt). */
function promptSistema(papel, cfg) {
  const regras = fs.readFileSync(path.join(RAIZ, 'CLAUDE.md'), 'utf8');
  const instrucoes = fs.readFileSync(path.join(RAIZ, H.papel(papel).instrucoes), 'utf8');
  const servico = [
    '# Modo serviço autônomo',
    `Você roda como agente "${papel}" dentro do serviço da HC Quality, sem um humano acompanhando em tempo real.`,
    'Sua única ferramenta é `hc` (a CLI comercial). O servidor define seu papel, a base de dados e a data; não os informe.',
    'Trabalhe só com dados que a CLI devolver. Dado ausente fica ausente e vira pendência. Nunca invente.',
    papel === 'vendedor'
      ? 'Você nunca envia mensagens. Em trabalhos de e-mail, a ferramenta rascunho_email cria um rascunho que o humano revisa e envia; fora disso, registre rascunhos como atividade (tipo nota).'
      : 'Você não envia e-mail nem WhatsApp e não fala com clientes; quando útil, registre rascunhos como atividade (tipo nota).',
    'Decisões fora da sua alçada: escale ao superior direto pela CLI. Decisões do humano: escalonamento até "humano" — ele decide pelo painel.',
    'Seja objetivo: execute o trabalho pedido e termine com um resumo de 3 a 8 linhas (o que fez, IDs criados/alterados, pendências, próximo passo).',
    cfg.base === 'demo' ? 'ATENÇÃO: base de DEMONSTRAÇÃO — todos os dados são fictícios; diga isso no resumo.' : '',
  ].join('\n');
  return `${regras}\n\n---\n\n${instrucoes}\n\n---\n\n${servico}`;
}

function textoDe(conteudo) {
  return conteudo
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Executor com a API do Claude. `cliente` é uma instância do SDK (ou um dublê nos testes).
 * ctl: { deveParar(): string|null, registrarTokens(n), evento(tipo, dados) }
 */
function criarExecutorClaude({ cfg, cliente, leitorEmail = null }) {
  const sistemas = {};
  const ferramentas = (papel) => (papel === 'vendedor' ? [DEFINICAO, RASCUNHO] : [DEFINICAO]);

  async function rascunho(papel, job, input, ctl) {
    if (papel !== 'vendedor') return { ok: false, saida: 'ERRO [FERRAMENTA]: só o vendedor cria rascunhos.' };
    if (!job.email) return { ok: false, saida: 'ERRO [FERRAMENTA]: este trabalho não tem e-mail para responder.' };
    if (job.rascunhoCriado) return { ok: false, saida: 'ERRO [FERRAMENTA]: o rascunho deste e-mail já foi criado (máximo um).' };
    const corpo = String((input || {}).corpo || '').trim();
    if (!corpo || corpo.length > LIMITE_RASCUNHO) return { ok: false, saida: `ERRO [FERRAMENTA]: corpo vazio ou maior que ${LIMITE_RASCUNHO} caracteres.` };
    if (!leitorEmail) return { ok: false, saida: 'ERRO [FERRAMENTA]: Gmail não configurado no serviço.' };
    try {
      const r = await leitorEmail.criarRascunho(job.email, corpo, papel);
      job.rascunhoCriado = true;
      ctl.evento('ferramenta', { comando: 'rascunho_email', ok: true, saida: `Rascunho criado para ${job.email.responderPara}` });
      return { ok: true, saida: `Rascunho criado no Gmail (${job.email.conta}) para ${job.email.responderPara}. Ele NÃO foi enviado: o responsável humano revisa e envia.` };
    } catch (e) {
      return { ok: false, saida: `ERRO [GMAIL]: ${e.message}` };
    }
  }

  return async function executarJob(papel, job, ctl) {
    sistemas[papel] = sistemas[papel] || promptSistema(papel, cfg);
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.fuso }).format(new Date());
    const texto = `Data de hoje: ${hoje}.\n\nTrabalho (${job.origem}): ${job.titulo}\n\n${job.instrucao}`;
    const messages = [{ role: 'user', content: job.blocos && job.blocos.length ? [...job.blocos, { type: 'text', text: texto }] : texto }];
    let tokens = 0;

    for (let i = 0; i < cfg.limites.iteracoesPorTarefa; i++) {
      const parar = ctl.deveParar();
      if (parar) return { status: 'interrompido', resumo: `Interrompido: ${parar}.`, tokens };

      const params = {
        model: cfg.modelo,
        max_tokens: 16000,
        system: [{ type: 'text', text: sistemas[papel], cache_control: { type: 'ephemeral' } }],
        tools: ferramentas(papel),
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: cfg.esforco },
      };
      const resposta = cfg.fallbacks
        ? await cliente.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await cliente.messages.create(params);

      const u = resposta.usage || {};
      const gasto = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      tokens += gasto;
      ctl.registrarTokens(gasto);

      const nota = textoDe(resposta.content || []);
      if (nota) ctl.evento('nota', { texto: resumir(nota, 600) });

      if (resposta.stop_reason === 'refusal') {
        return { status: 'recusado', resumo: 'O modelo recusou a solicitação; nada foi executado a partir daqui.', tokens };
      }
      if (resposta.stop_reason === 'max_tokens') {
        return { status: 'truncado', resumo: nota || 'Resposta truncada pelo limite de tokens.', tokens };
      }
      messages.push({ role: 'assistant', content: resposta.content });
      if (resposta.stop_reason === 'pause_turn') continue;
      if (resposta.stop_reason !== 'tool_use') return { status: 'concluido', resumo: nota || '(sem resumo)', tokens };

      const resultados = [];
      for (const bloco of resposta.content.filter((b) => b.type === 'tool_use')) {
        let r;
        if (bloco.name === 'rascunho_email') r = await rascunho(papel, job, bloco.input, ctl);
        else if (bloco.name !== 'hc') r = { ok: false, saida: `ERRO [FERRAMENTA]: ferramenta desconhecida "${bloco.name}".`, argumentos: [] };
        else {
          r = await executarHc(papel, (bloco.input || {}).argumentos, cfg);
          ctl.evento('ferramenta', { comando: (r.argumentos || []).slice(0, 3).join(' '), ok: r.ok, saida: resumir(r.saida, 300) });
        }
        resultados.push({ type: 'tool_result', tool_use_id: bloco.id, content: r.saida, is_error: !r.ok });
      }
      messages.push({ role: 'user', content: resultados });
    }
    return { status: 'limite', resumo: `Parado no limite de ${cfg.limites.iteracoesPorTarefa} iterações.`, tokens };
  };
}

/** Executor sem IA: roda os comandos fixos da rotina. Trabalhos sem roteiro ficam para o modo claude. */
function criarExecutorSimulado({ cfg, pausaMs = 400 }) {
  return async function executarJob(papel, job, ctl) {
    if (!job.simulado || !job.simulado.length) {
      return { status: 'ignorado', resumo: 'Modo simulado: este trabalho exige o modo claude (ANTHROPIC_API_KEY).', tokens: 0 };
    }
    const linhas = [];
    for (const argv of job.simulado) {
      const parar = ctl.deveParar();
      if (parar) return { status: 'interrompido', resumo: `Interrompido: ${parar}.`, tokens: 0 };
      const r = await executarHc(papel, argv, cfg);
      ctl.evento('ferramenta', { comando: argv.slice(0, 3).join(' '), ok: r.ok, saida: resumir(r.saida, 300) });
      linhas.push(`${r.ok ? 'ok' : 'erro'}: ${argv.join(' ')}`);
      if (pausaMs) await new Promise((res) => setTimeout(res, pausaMs));
    }
    return { status: 'concluido', resumo: `Modo simulado (sem IA). ${linhas.join(' · ')}`, tokens: 0 };
  };
}

module.exports = { criarExecutorClaude, criarExecutorSimulado, promptSistema, RASCUNHO };
