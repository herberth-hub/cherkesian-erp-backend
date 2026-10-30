'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RAIZ, REPO } = require('./_util');
const { resolver, ANALISES } = require('../src/cli');
const { SCHEMAS } = require('../src/schemas');
const H = require('../src/hierarquia');

const ler = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const ARQ_AGENTES = { ceo: 'ceo.md', diretor: 'diretor_comercial.md', gerente: 'gerente_comercial.md', vendedor: 'vendedor_comercial.md' };

function responsabilidades(md) {
  const bloco = md.split(/^## Responsabilidades.*$/m)[1].split(/^## /m)[0];
  return bloco.split('\n').filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim().toLowerCase());
}

test('existem exatamente quatro agentes, cada um com instruções próprias e seções obrigatórias', () => {
  const papeisIA = Object.entries(H.PAPEIS).filter(([, d]) => d.agenteNativo);
  assert.equal(papeisIA.length, 4);
  for (const [papel, d] of papeisIA) {
    const md = ler(RAIZ, d.instrucoes);
    for (const secao of ['## Identidade', '## Missão', '## Responsabilidades', '## Indicadores', 'scalonamento', '## Entregas']) {
      assert.ok(md.includes(secao), `${papel}: falta seção "${secao}"`);
    }
    assert.ok(/^## .*([Ll]imites|Autonomia)/m.test(md), `${papel}: falta seção de limites/autonomia`);
    assert.ok(fs.existsSync(path.join(REPO, '.claude/agents', `${d.agenteNativo}.md`)), `${papel}: agente nativo ausente`);
    assert.ok(ler(REPO, '.claude/agents', `${d.agenteNativo}.md`).includes(`comercial-inteligente/agents/${ARQ_AGENTES[papel]}`));
  }
});

test('responsabilidades dos quatro agentes são distintas (nenhum item repetido entre agentes)', () => {
  const vistos = new Map();
  for (const [papel, arq] of Object.entries(ARQ_AGENTES)) {
    const itens = responsabilidades(ler(RAIZ, 'agents', arq));
    assert.ok(itens.length >= 12, `${papel}: ao menos 12 responsabilidades (tem ${itens.length})`);
    for (const it of itens) {
      assert.ok(!vistos.has(it), `responsabilidade repetida entre ${vistos.get(it)} e ${papel}: "${it}"`);
      vistos.set(it, papel);
    }
  }
});

test('hierarquia documentada no CLAUDE.md bate com a configuração aplicada', () => {
  const md = ler(RAIZ, 'CLAUDE.md');
  for (const [papel, d] of Object.entries(H.PAPEIS)) {
    if (d.agenteNativo) {
      assert.ok(md.includes(d.agenteNativo), `CLAUDE.md cita ${d.agenteNativo}`);
      assert.ok(md.includes(`--agente ${papel}`));
    }
  }
  for (const [papel, arq] of Object.entries(ARQ_AGENTES)) {
    const md2 = ler(RAIZ, 'agents', arq);
    const sup = H.superior(papel) === 'humano' ? 'responsável humano' : null;
    if (sup) assert.match(md2, /Superior: \*\*responsável humano\*\*/);
  }
});

/** Todos os comandos da CLI citados na documentação e nos slash commands precisam existir. */
function arquivosDoc() {
  const pastas = [path.join(REPO, '.claude/commands'), path.join(REPO, '.claude/agents'), ...['agents', 'knowledge', 'workflows', 'reports'].map((p) => path.join(RAIZ, p))];
  const arqs = pastas.flatMap((p) => fs.readdirSync(p).filter((f) => f.endsWith('.md')).map((f) => path.join(p, f)));
  return [...arqs, path.join(RAIZ, 'README.md'), path.join(RAIZ, 'CLAUDE.md')];
}

test('todo comando da CLI citado na documentação existe (nada de interface fictícia)', () => {
  const CMD = /hc\.js\s+([a-z-]+)(?:\s+([a-z-]+))?/g;
  const CRASE = /`(politica|proposta|aprovacao|solicitacao|tarefa|meta|erp|demo) ([a-z]+)/g;
  let conferidos = 0;
  for (const arq of arquivosDoc()) {
    const txt = ler(arq);
    for (const m of txt.matchAll(CMD)) {
      if (m[1] === 'ajuda') continue;
      const r = resolver([m[1], m[2]].filter(Boolean));
      assert.ok(r && !r.erroSub, `${path.basename(arq)}: comando inexistente "hc.js ${m[1]} ${m[2] || ''}"`);
      conferidos++;
    }
    for (const m of txt.matchAll(CRASE)) {
      const r = resolver([m[1], m[2]]);
      assert.ok(r && !r.erroSub, `${path.basename(arq)}: subcomando inexistente "${m[1]} ${m[2]}"`);
      conferidos++;
    }
    for (const m of txt.matchAll(/`pipeline ([a-z-]+)/g)) assert.ok(ANALISES[m[1]], `${path.basename(arq)}: análise inexistente "pipeline ${m[1]}"`);
    for (const m of txt.matchAll(/`relatorio ([a-z]+)/g)) assert.ok(['vendedor', 'gerente', 'diretor', 'ceo'].includes(m[1]), `${path.basename(arq)}: relatório inexistente "${m[1]}"`);
    for (const m of txt.matchAll(/\*\*(hc-[a-z-]+)\*\*/g)) assert.ok(fs.existsSync(path.join(REPO, '.claude/agents', `${m[1]}.md`)), `${path.basename(arq)}: agente ${m[1]} não existe`);
  }
  assert.ok(conferidos > 30, `poucos comandos conferidos (${conferidos})`);
});

test('os 13 comandos operacionais existem e acionam agentes reais', () => {
  const esperados = [
    'com-reuniao-diaria', 'com-relatorio-executivo', 'com-analisar-carteira', 'com-planejar-prospeccao', 'com-sem-follow-up',
    'com-propostas-pendentes', 'com-avaliar-margem', 'com-planejar-meta', 'com-recuperar-inativos', 'com-novo-segmento',
    'com-pedidos-em-risco', 'com-desempenho-vendedores', 'com-reuniao-ceo',
  ];
  for (const c of esperados) {
    const txt = ler(REPO, '.claude/commands', `${c}.md`);
    assert.match(txt, /^---\ndescription: .+\nargument-hint: ".*"\nallowed-tools: Bash\(node comercial-inteligente\/bin\/hc\.js \*\), Read, Grep, Glob\n---/);
    assert.match(txt, /\*\*hc-[a-z-]+\*\*|hc\.js/);
    assert.match(txt, /Máximo de 8 acionamentos/);
  }
});

test('schemas JSON publicados estão sincronizados com src/schemas.js e cobrem as entidades mínimas', () => {
  const minimas = ['cliente', 'contato', 'lead', 'oportunidade', 'atividade', 'proposta', 'pedido', 'produto', 'meta', 'agente', 'aprovacao', 'historico'];
  for (const e of minimas) assert.ok(SCHEMAS[e], `entidade mínima ${e}`);
  for (const [nome, schema] of Object.entries(SCHEMAS)) {
    const publicado = JSON.parse(ler(RAIZ, 'schemas', `${nome}.schema.json`));
    assert.deepEqual(publicado, JSON.parse(JSON.stringify(schema)), `${nome}.schema.json desatualizado: rode npm run schemas`);
    assert.ok(schema.required.includes('id') && schema.properties.id.pattern, `${nome}: id único obrigatório`);
  }
});

test('documentação de instalação e uso existe', () => {
  const md = ler(RAIZ, 'README.md');
  for (const s of ['## Instalação', '## Uso', '## Limitações', '## Testes', '## Ativação em produção']) assert.ok(md.includes(s), `README sem "${s}"`);
  assert.ok(fs.existsSync(path.join(RAIZ, 'data', 'README.md')));
  assert.ok(fs.existsSync(path.join(RAIZ, 'integracoes', 'README.md')));
});
