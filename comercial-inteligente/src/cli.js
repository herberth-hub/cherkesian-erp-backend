'use strict';

/**
 * CLI do sistema de inteligência comercial: `node comercial-inteligente/bin/hc.js <comando> [subcomando] --agente <papel> ...`
 * Toda execução exige o papel do agente (--agente) e é registrada em data/<base>/logs/execucao.jsonl.
 */

const fs = require('fs');
const path = require('path');
const { Base } = require('./store');
const { ErroNegocio } = require('./erros');
const H = require('./hierarquia');
const C = require('./comercial');
const PR = require('./protocolo');
const A = require('./analises');
const R = require('./relatorios');
const { calcularMargem, determinarAlcada } = require('./precificacao');
const { registrar: logar, ocultarArgs } = require('./log');
const { ENTIDADES } = require('./schemas');

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      if (v.length) flags[k] = v.join('=');
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const exigir = (flags, k, desc) => {
  if (flags[k] === undefined || flags[k] === true || String(flags[k]).trim() === '') {
    throw new ErroNegocio('ARGUMENTO_AUSENTE', `Informe --${k}${desc ? ` (${desc})` : ''}.`);
  }
  return String(flags[k]);
};
const numero = (flags, k) => {
  if (flags[k] === undefined) return undefined;
  const n = Number(String(flags[k]).replace(',', '.'));
  if (isNaN(n)) throw new ErroNegocio('ARGUMENTO_INVALIDO', `--${k} deve ser numérico.`);
  return n;
};
const lista = (v) => (v && v !== true ? String(v).split(';').map((s) => s.trim()).filter(Boolean) : []);
function json(flags) {
  const bruto = exigir(flags, 'json', 'objeto JSON com os campos');
  try {
    return JSON.parse(bruto);
  } catch (e) {
    throw new ErroNegocio('JSON_INVALIDO', `--json não é um JSON válido: ${e.message}`);
  }
}
function exigirEntidade(nome) {
  if (!ENTIDADES.includes(nome)) throw new ErroNegocio('ENTIDADE_INVALIDA', `Entidade inválida: ${nome}. Use: ${ENTIDADES.join(', ')}.`);
  return nome;
}

const ANALISES = {
  'sem-follow-up': (b, o) => A.semFollowUp(b, o),
  parados: (b, o) => A.parados(b, { ...o, diasLimite: o.premissas.diasSemContatoParaAlerta }),
  'dados-ausentes': (b, o) => A.dadosAusentes(b, o),
  'propostas-pendentes': (b, o) => A.propostasPendentes(b, o),
  duplicidades: (b) => A.duplicidades(b),
  inativos: (b, o) => A.clientesInativos(b, { ...o, diasLimite: o.premissas.diasInatividadeCliente }),
  'pedidos-risco': (b, o) => A.pedidosEmRisco(b, { ...o, diasAlerta: o.premissas.diasAlertaPrazoPedido }),
  desempenho: (b, o) => A.desempenhoPorVendedor(b, { inicio: o.inicio, fim: o.hoje }),
  concentracao: (b, o) => A.concentracao(b, { inicio: A.somarDias(o.hoje, -364), fim: o.hoje }),
  previsao: (b, o) => A.previsao(b, o),
  funil: (b, o) => A.funil(b, o),
  metas: (b, o) => A.metas(b, { periodo: o.periodo }),
  carteira: (b, o) => ({
    funil: A.funil(b, o),
    inativos: A.clientesInativos(b, { ...o, diasLimite: o.premissas.diasInatividadeCliente }),
    concentracao: A.concentracao(b, { inicio: A.somarDias(o.hoje, -364), fim: o.hoje }),
    semFollowUp: A.semFollowUp(b, o),
    duplicidades: A.duplicidades(b),
  }),
};

/**
 * Registro de comandos. `papeis` restringe quem pode executar; a validação fina
 * (alçada, hierarquia, propriedade do registro) acontece nos módulos de domínio.
 */
const COMANDOS = {
  ajuda: { desc: 'Lista os comandos.', run: () => ajuda() },
  hierarquia: {
    desc: 'Mostra a cadeia de comando e as cadeias de escalonamento.',
    run: () => Object.entries(H.PAPEIS).map(([p, d]) => ({ papel: p, nome: d.nome, nivel: d.nivel, superior: d.superior, subordinado: d.subordinado, escalonamento: H.cadeiaEscalonamento(p).join(' → ') })),
  },
  validar: { desc: 'Valida todos os registros da base (schema + referências).', run: ({ base }) => {
    const problemas = base.auditar();
    return { ok: problemas.length === 0, problemas };
  } },
  politica: {
    sub: {
      mostrar: { desc: 'Mostra a política comercial efetiva e se está configurada.', run: ({ base }) => base.politica() },
      definir: {
        papeis: ['humano'],
        desc: "politica definir --json '{...}' (valida coerência das alçadas e grava na base)",
        run: ({ base, flags, hoje }) => require('./politica').salvarPolitica(base, json(flags), { hoje }),
      },
    },
  },
  listar: { desc: 'listar <entidade> [--filtro campo=valor]', run: ({ base, pos, flags }) => {
    const ent = exigirEntidade(pos[0]);
    let regs = base.listar(ent);
    if (flags.filtro && flags.filtro !== true) {
      const [k, v] = String(flags.filtro).split('=');
      regs = regs.filter((r) => String(r[k]) === v);
    }
    return regs;
  } },
  obter: { desc: 'obter <entidade> --id ID', run: ({ base, pos, flags }) => base.exigir(exigirEntidade(pos[0]), exigir(flags, 'id')) },
  registrar: { desc: "registrar <entidade> --json '{...}' (valida, checa duplicidade e permissão)", run: ({ base, pos, flags, agente, hoje }) => C.registrar(base, agente, exigirEntidade(pos[0]), json(flags), hoje) },
  atualizar: { desc: "atualizar <entidade> --id ID --json '{...}'", run: ({ base, pos, flags, agente }) => C.atualizar(base, agente, exigirEntidade(pos[0]), exigir(flags, 'id'), json(flags)) },
  margem: {
    desc: 'Calcula margem de contribuição: --preco --qtd --custo --impostos [--comissao --frete --outros --preco-tabela]',
    run: ({ base, flags }) => {
      const m = calcularMargem({
        precoUnitario: numero(flags, 'preco'),
        quantidade: numero(flags, 'qtd'),
        custoVariavelUnitario: numero(flags, 'custo'),
        impostosPercent: numero(flags, 'impostos'),
        comissaoPercent: numero(flags, 'comissao'),
        freteTotal: numero(flags, 'frete'),
        outrosCustosVariaveis: numero(flags, 'outros'),
      });
      const tabela = numero(flags, 'preco-tabela');
      const preco = numero(flags, 'preco');
      const desconto = tabela && preco != null ? Math.max(0, Math.round(((tabela - preco) / tabela) * 10000) / 100) : 0;
      const alcada = determinarAlcada({ margem: m, descontoPercent: desconto, valorTotal: m.receitaBruta || 0, politica: base.politica(), semPrecoAutorizado: tabela ? [] : ['preço sem tabela informada (--preco-tabela)'] });
      return { margem: m, descontoPercent: desconto, alcada };
    },
  },
  proposta: {
    sub: {
      avaliar: { desc: 'proposta avaliar --id PRO-xxxx (grava margem, desconto, alçada e pendências)', run: ({ base, flags, agente, hoje }) => C.avaliar(base, agente, exigir(flags, 'id'), hoje) },
    },
  },
  aprovacao: {
    sub: {
      solicitar: { desc: 'aprovacao solicitar --proposta PRO-xxxx', run: ({ base, flags, agente, hoje }) => C.solicitarAprovacao(base, agente, exigir(flags, 'proposta'), hoje) },
      decidir: {
        desc: 'aprovacao decidir --id APR-xxxx --decisao aprovada|recusada --justificativa "..." [--confirmar APR-xxxx quando humano]',
        run: ({ base, flags, agente, hoje }) => {
          const id = exigir(flags, 'id');
          if (agente === 'humano' && flags.confirmar !== id) {
            throw new ErroNegocio('CONFIRMACAO_HUMANA', `Decisão humana exige confirmação reforçada: repita o identificador com --confirmar ${id}.`);
          }
          return C.decidirAprovacao(base, agente, { id, decisao: exigir(flags, 'decisao'), justificativa: exigir(flags, 'justificativa') }, hoje);
        },
      },
      listar: { desc: 'aprovacao listar [--status pendente]', run: ({ base, flags }) => base.listar('aprovacao').filter((a) => !flags.status || a.status === flags.status) },
    },
  },
  solicitacao: {
    sub: {
      criar: {
        desc: 'solicitacao criar --para PAPEL --fluxo delegacao|escalonamento --objetivo "..." --prazo AAAA-MM-DD --resultado-esperado "..." [--ref tipo:id --dados "..." --faltantes "a;b" --origem SOL-xxxx]',
        run: ({ base, flags, agente, hoje }) =>
          PR.criarSolicitacao(
            base,
            {
              agente,
              para: exigir(flags, 'para'),
              fluxo: exigir(flags, 'fluxo'),
              objetivo: flags.objetivo,
              prazo: flags.prazo,
              resultadoEsperado: flags['resultado-esperado'],
              referencia: flags.ref && flags.ref !== true ? flags.ref : null,
              dadosDisponiveis: flags.dados && flags.dados !== true ? flags.dados : null,
              informacoesFaltantes: lista(flags.faltantes),
              origemId: flags.origem && flags.origem !== true ? flags.origem : null,
            },
            hoje,
          ),
      },
      responder: {
        desc: 'solicitacao responder --id SOL-xxxx --tipo decisao|conclusao|pedido_informacao|escalonamento|informacao --texto "..." [--faltantes "a;b" --prazo AAAA-MM-DD]',
        run: ({ base, flags, agente, hoje }) =>
          PR.responderSolicitacao(base, { agente, id: exigir(flags, 'id'), tipo: exigir(flags, 'tipo'), texto: flags.texto, informacoesFaltantes: lista(flags.faltantes), prazo: flags.prazo }, hoje),
      },
      verificar: {
        desc: 'solicitacao verificar --id SOL-xxxx --aceitar|--devolver --texto "evidência"',
        run: ({ base, flags, agente }) => {
          if (!flags.aceitar === !flags.devolver) throw new ErroNegocio('ARGUMENTO_AUSENTE', 'Use exatamente um: --aceitar ou --devolver.');
          return PR.verificarSolicitacao(base, { agente, id: exigir(flags, 'id'), aceitar: Boolean(flags.aceitar), texto: flags.texto });
        },
      },
      listar: { desc: 'solicitacao listar [--status S] [--todas]', run: ({ base, flags, agente, hoje }) => PR.listarSolicitacoes(base, { agente: flags.todas ? undefined : agente, status: flags.status, hoje }) },
    },
  },
  tarefa: {
    sub: {
      criar: {
        desc: 'tarefa criar --responsavel PAPEL --titulo "..." --prazo AAAA-MM-DD --condicao "..." [--responsavel-id AGT-x --solicitacao SOL-x --ref tipo:id]',
        run: ({ base, flags, agente }) =>
          PR.criarTarefa(base, {
            agente,
            responsavel: exigir(flags, 'responsavel'),
            titulo: flags.titulo,
            prazo: flags.prazo,
            condicaoConclusao: flags.condicao,
            responsavelId: flags['responsavel-id'],
            solicitacaoId: flags.solicitacao,
            referencia: flags.ref,
          }),
      },
      mover: { desc: 'tarefa mover --id TAR-xxxx --status S [--evidencia "..."]', run: ({ base, flags, agente }) => PR.moverTarefa(base, { agente, id: exigir(flags, 'id'), status: exigir(flags, 'status'), evidencia: flags.evidencia }) },
      listar: { desc: 'tarefa listar [--todas]', run: ({ base, flags, agente }) => base.listar('tarefa').filter((t) => flags.todas || t.responsavel === agente || t.atribuidaPor === agente) },
    },
  },
  meta: {
    sub: {
      definir: {
        desc: 'meta definir --nivel empresa|diretor|gerente|vendedor|segmento --periodo AAAA-MM --faturamento N [--meta-pai MET-x --responsavel-id AGT-x --segmento S --margem-minima N --novos-clientes N]',
        run: ({ base, flags, agente }) =>
          C.definirMeta(base, agente, {
            nivel: exigir(flags, 'nivel'),
            periodo: exigir(flags, 'periodo'),
            faturamento: numero(flags, 'faturamento'),
            metaPaiId: flags['meta-pai'] || null,
            responsavelId: flags['responsavel-id'] || null,
            segmento: flags.segmento || null,
            margemMinimaPercent: numero(flags, 'margem-minima') ?? null,
            novosClientes: numero(flags, 'novos-clientes') ?? null,
          }),
      },
      cobertura: { desc: 'meta cobertura --id MET-xxxx (soma dos desdobramentos vs meta)', run: ({ base, flags }) => C.coberturaMeta(base, exigir(flags, 'id')) },
    },
  },
  pipeline: {
    desc: `pipeline <${Object.keys(ANALISES).join('|')}> [--responsavel AGT-x]`,
    run: ({ base, pos, flags, hoje }) => {
      const f = ANALISES[pos[0]];
      if (!f) throw new ErroNegocio('ANALISE_INVALIDA', `Análise inválida. Use: ${Object.keys(ANALISES).join(', ')}.`);
      const { inicio, periodo } = A.intervaloMes(hoje);
      return f(base, { hoje, inicio, periodo: flags.periodo || periodo, responsavelId: flags.responsavel, premissas: base.premissas() });
    },
  },
  relatorio: {
    desc: 'relatorio vendedor|gerente|diretor|ceo [--responsavel AGT-x (vendedor)] [--salvar] [--formato json]',
    run: ({ base, pos, flags, hoje, agente }) => {
      const tipo = pos[0];
      if (tipo === 'vendedor' && !flags.responsavel) {
        const opcoes = base.listar('agente').filter((a) => a.papel === 'vendedor').map((a) => `${a.id} (${a.nome})`);
        throw new ErroNegocio('ARGUMENTO_AUSENTE', `Relatório do vendedor exige --responsavel. Opções: ${opcoes.join(', ') || 'nenhum vendedor cadastrado'}.`);
      }
      const rel = R.gerar(tipo, base, { hoje, responsavelId: flags.responsavel });
      const md = rel.markdown();
      if (flags.salvar) {
        const dir = path.join(base.dir, 'relatorios');
        fs.mkdirSync(dir, { recursive: true });
        const arq = path.join(dir, `${tipo}${flags.responsavel ? `-${flags.responsavel}` : ''}-${hoje}.md`);
        fs.writeFileSync(arq, md);
        logar(base.dir, { agente, evento: 'relatorio_salvo', arquivo: arq });
      }
      return flags.formato === 'json' ? rel.json() : { __texto: md };
    },
  },
  erp: {
    sub: {
      importar: {
        papeis: ['humano'],
        desc: 'erp importar --recurso clientes|produtos|pedidos|leads [--responsavel AGT-x] (somente leitura do ERP; exige ERP_API_URL/ERP_USUARIO/ERP_SENHA)',
        run: async ({ base, flags }) => {
          if (base.ficticia) throw new ErroNegocio('BASE_INVALIDA', 'Importação do ERP só na base de produção.');
          const { importar } = require('../integracoes/erp');
          return importar(base, exigir(flags, 'recurso'), { responsavelPadraoId: flags.responsavel });
        },
      },
    },
  },
  demo: {
    sub: {
      restaurar: { papeis: ['humano'], desc: 'demo restaurar (recria data/demo a partir da semente fictícia)', run: () => ({ restaurada: Base.restaurarDemo() }) },
    },
  },
};

function ajuda() {
  const linhas = ['Uso: node comercial-inteligente/bin/hc.js <comando> [sub] --agente <ceo|diretor|gerente|vendedor|humano> [--base producao|demo] [--hoje AAAA-MM-DD]', ''];
  for (const [nome, c] of Object.entries(COMANDOS)) {
    if (c.sub) for (const [s, d] of Object.entries(c.sub)) linhas.push(`  ${nome} ${s}${d.papeis ? ` [${d.papeis.join(',')}]` : ''} — ${d.desc}`);
    else linhas.push(`  ${nome} — ${c.desc}`);
  }
  return { __texto: linhas.join('\n') + '\n' };
}

/** Resolve o comando (com subcomando) a partir dos argumentos posicionais. */
function resolver(pos) {
  const c = COMANDOS[pos[0]];
  if (!c) return null;
  if (!c.sub) return { def: c, resto: pos.slice(1), nome: pos[0] };
  const s = c.sub[pos[1]];
  if (!s) return { erroSub: `Subcomando de "${pos[0]}": ${Object.keys(c.sub).join(', ')}.` };
  return { def: s, resto: pos.slice(2), nome: `${pos[0]} ${pos[1]}` };
}

/** Executa e devolve { codigo, saida } sem encerrar o processo (testável). */
async function executar(argv, env = process.env) {
  const { pos, flags } = parse(argv);
  if (!pos.length || pos[0] === 'ajuda' || flags.ajuda) return { codigo: 0, saida: ajuda().__texto };
  const r = resolver(pos);
  if (!r) return { codigo: 2, saida: `ERRO [COMANDO_INVALIDO]: comando desconhecido "${pos[0]}".\n${ajuda().__texto}` };
  if (r.erroSub) return { codigo: 2, saida: `ERRO [COMANDO_INVALIDO]: ${r.erroSub}\n` };

  let base;
  const agente = flags.agente;
  try {
    if (!agente || agente === true) throw new ErroNegocio('AGENTE_OBRIGATORIO', 'Informe o papel executor: --agente ceo|diretor|gerente|vendedor|humano.');
    H.papel(agente);
    if (r.def.papeis && !r.def.papeis.includes(agente)) throw new ErroNegocio('PERMISSAO_NEGADA', `"${r.nome}" é exclusivo de: ${r.def.papeis.join(', ')}.`);
    const hoje = flags.hoje && flags.hoje !== true ? String(flags.hoje) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new ErroNegocio('ARGUMENTO_INVALIDO', '--hoje deve ser AAAA-MM-DD.');
    base = Base.abrir({ nome: flags.base && flags.base !== true ? flags.base : env.HC_BASE || 'producao', dir: env.HC_DATA_DIR });
    const res = await r.def.run({ base, pos: r.resto, flags, agente, hoje });
    logar(base.dir, { agente, comando: r.nome, args: ocultarArgs(argv), ok: true });
    const saida = res && res.__texto !== undefined ? res.__texto : JSON.stringify(res, null, 2) + '\n';
    return { codigo: 0, saida };
  } catch (e) {
    if (base) logar(base.dir, { agente, comando: r.nome, args: ocultarArgs(argv), ok: false, erro: e.codigo || e.name, mensagem: e.message });
    const codigo = e instanceof ErroNegocio || e.codigo ? e.codigo : 'ERRO_INTERNO';
    return { codigo: 1, saida: `ERRO [${codigo}]: ${e.message}\n` };
  }
}

module.exports = { executar, parse, COMANDOS, ANALISES, resolver };
