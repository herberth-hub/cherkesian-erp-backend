'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { avaliar } = require('../bin/guard-bash');
const { REPO, baseDemo, cli } = require('./_util');

const ok = (papel, cmd) => assert.equal(avaliar(papel, cmd, REPO), null, cmd);
const bloqueia = (papel, cmd, re) => {
  const m = avaliar(papel, cmd, REPO);
  assert.ok(m, `deveria bloquear: ${cmd}`);
  if (re) assert.match(m, re);
};

test('hook permite somente a CLI com o próprio papel', () => {
  ok('vendedor', 'node comercial-inteligente/bin/hc.js relatorio vendedor --responsavel AGT-0005 --agente vendedor --base demo');
  ok('gerente', `node ${path.join(REPO, 'comercial-inteligente/bin/hc.js')} pipeline parados --agente=gerente`);
  ok('diretor', `node comercial-inteligente/bin/hc.js registrar lead --json '{"empresa":"A","segmento":"saude","fonte":"lista","status":"novo"}' --agente diretor`);
});

test('hook bloqueia outros programas, encadeamento, redirecionamento e expansão de variável', () => {
  bloqueia('ceo', 'cat .env', /só executam/);
  bloqueia('ceo', 'curl https://exemplo.invalid', /só executam/);
  bloqueia('ceo', 'node -e "require(\'fs\')"', /só executam/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js listar cliente --agente ceo; rm -rf data', /encadeamento/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js listar cliente --agente ceo && echo', /encadeamento/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js listar cliente --agente ceo | tee x', /encadeamento/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js listar cliente --agente ceo > /tmp/x', /redirecionamento/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js registrar lead --json "$(cat .env)" --agente ceo', /subshell|expansão/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js registrar lead --json "$ERP_SENHA" --agente ceo', /expansão/);
  bloqueia('ceo', 'node /tmp/falso/comercial-inteligente/bin/hc.js listar cliente --agente ceo', /só executam/);
});

test('hook impede um papel de agir como outro ou como o humano', () => {
  bloqueia('vendedor', 'node comercial-inteligente/bin/hc.js aprovacao decidir --id APR-0001 --decisao aprovada --justificativa x --agente gerente', /não pode agir como "gerente"/);
  bloqueia('ceo', 'node comercial-inteligente/bin/hc.js aprovacao decidir --id APR-0001 --agente humano', /não pode agir como "humano"/);
  bloqueia('gerente', 'node comercial-inteligente/bin/hc.js listar cliente', /exatamente um --agente/);
  bloqueia('gerente', 'node comercial-inteligente/bin/hc.js listar cliente --agente gerente --agente=humano', /exatamente um/);
  bloqueia('diretor', 'node comercial-inteligente/bin/hc.js erp importar --recurso clientes --agente diretor', /exclusivo do responsável humano/);
  bloqueia('diretor', 'node comercial-inteligente/bin/hc.js demo restaurar --agente diretor', /exclusivo/);
});

test('hook como processo: exit 2 bloqueia e exit 0 libera', () => {
  const rodar = (papel, command) => spawnSync('node', [path.join(REPO, 'comercial-inteligente/bin/guard-bash.js'), papel], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: REPO }) });
  assert.equal(rodar('gerente', 'node comercial-inteligente/bin/hc.js hierarquia --agente gerente').status, 0);
  const r = rodar('gerente', 'ls -la');
  assert.equal(r.status, 2);
  assert.match(String(r.stderr), /só executam/);
  const lixo = spawnSync('node', [path.join(REPO, 'comercial-inteligente/bin/guard-bash.js'), 'gerente'], { input: 'não é json' });
  assert.equal(lixo.status, 2, 'entrada inválida bloqueia por segurança');
});

test('CLI: comandos exclusivos do humano recusam agentes', async () => {
  const b = baseDemo();
  for (const papel of ['ceo', 'diretor', 'gerente', 'vendedor']) {
    const r = await cli(b.dir, ['erp', 'importar', '--recurso', 'clientes', '--agente', papel]);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /PERMISSAO_NEGADA/);
  }
  const semAgente = await cli(b.dir, ['listar', 'cliente']);
  assert.match(semAgente.saida, /AGENTE_OBRIGATORIO/);
  const humanoSemConfirmar = await cli(b.dir, ['aprovacao', 'decidir', '--id', 'APR-0001', '--decisao', 'aprovada', '--justificativa', 'x', '--agente', 'humano']);
  assert.match(humanoSemConfirmar.saida, /CONFIRMACAO_HUMANA/);
});

test('CLI: integração ERP sem credenciais falha com mensagem clara, sem simular sucesso', async () => {
  const dir = path.join(require('./_util').tmp(), 'producao');
  const r = await require('../src/cli').executar(['erp', 'importar', '--recurso', 'clientes', '--agente', 'humano', '--base', 'producao'], { HC_DATA_DIR: dir });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /ERP_NAO_CONFIGURADO/);
});

const AGENTES = ['hc-ceo', 'hc-diretor-comercial', 'hc-gerente-comercial', 'hc-vendedor-comercial'];
const PAPEL = { 'hc-ceo': 'ceo', 'hc-diretor-comercial': 'diretor', 'hc-gerente-comercial': 'gerente', 'hc-vendedor-comercial': 'vendedor' };

function frontmatter(arq) {
  const txt = fs.readFileSync(arq, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${arq} sem frontmatter`);
  const campo = (k) => ((m[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '').trim();
  return { raw: m[1], corpo: txt.slice(m[0].length), name: campo('name'), tools: campo('tools').split(',').map((s) => s.trim()), disallowed: campo('disallowedTools').split(',').map((s) => s.trim()) };
}

test('subagentes nativos: menor privilégio (sem Write/Edit/Web/Agent) e hook com o papel correto', () => {
  for (const nome of AGENTES) {
    const fm = frontmatter(path.join(REPO, '.claude/agents', `${nome}.md`));
    assert.equal(fm.name, nome);
    assert.deepEqual(fm.tools.sort(), ['Bash', 'Glob', 'Grep', 'Read']);
    for (const t of ['Write', 'Edit', 'WebFetch', 'WebSearch', 'Agent']) assert.ok(fm.disallowed.includes(t), `${nome} deve negar ${t}`);
    assert.match(fm.raw, /PreToolUse:\s*\n\s*- matcher: "Bash"/);
    assert.ok(fm.raw.includes(`guard-bash.js" ${PAPEL[nome]}'`), `${nome}: hook com papel ${PAPEL[nome]}`);
    assert.ok(!/mcpServers/.test(fm.raw), 'sem servidores MCP (sem canais externos)');
  }
});

test('settings do projeto: CLI liberada, ações humanas pedem confirmação, .env negado', () => {
  const s = JSON.parse(fs.readFileSync(path.join(REPO, '.claude/settings.json'), 'utf8'));
  assert.ok(s.permissions.allow.includes('Bash(node comercial-inteligente/bin/hc.js *)'));
  assert.ok(s.permissions.ask.some((r) => r.includes('--agente humano')));
  assert.ok(s.permissions.ask.some((r) => r.includes('hc.js erp')));
  assert.ok(s.permissions.deny.includes('Read(./.env)'));
  assert.ok(!s.permissions.allow.some((r) => /^Bash\(\*?\)$|Bash\(\*\)/.test(r)), 'sem Bash irrestrito');
});

test('dados reais e cópia de trabalho ficam fora do git', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', 'data', '.gitignore'), 'utf8');
  assert.match(gi, /^\/producao\/$/m);
  assert.match(gi, /^\/demo\/$/m);
});

test('hook em modo --auto (settings do projeto): aplica a regra só aos subagentes hc-*', () => {
  const { papelDoAgente } = require('../bin/guard-bash');
  assert.equal(papelDoAgente('hc-vendedor-comercial'), 'vendedor');
  assert.equal(papelDoAgente('plugin:hc-ceo'), 'ceo');
  assert.equal(papelDoAgente('Explore'), null);
  assert.equal(papelDoAgente(undefined), null);
  const rodar = (agent_type, command) =>
    spawnSync('node', [path.join(REPO, 'comercial-inteligente/bin/guard-bash.js'), '--auto'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: REPO, agent_type }) }).status;
  assert.equal(rodar('hc-diretor-comercial', 'ls'), 2);
  assert.equal(rodar('hc-diretor-comercial', 'node comercial-inteligente/bin/hc.js listar cliente --agente gerente'), 2);
  assert.equal(rodar('hc-diretor-comercial', 'node comercial-inteligente/bin/hc.js listar cliente --agente diretor'), 0);
  assert.equal(rodar(undefined, 'npm test'), 0, 'sessão principal e outros agentes não são afetados');
  assert.equal(rodar('general-purpose', 'ls'), 0);
  const s = JSON.parse(fs.readFileSync(path.join(REPO, '.claude/settings.json'), 'utf8'));
  const h = s.hooks.PreToolUse.find((x) => x.matcher === 'Bash');
  assert.ok(h.hooks.some((x) => x.command.includes('guard-bash.js\" --auto')));
});
