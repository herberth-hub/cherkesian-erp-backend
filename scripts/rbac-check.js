/**
 * Verifica a coerência do RBAC entre as duas pontas do ERP.
 *
 *   frontend  public/index.html   ACCESS      (perfil -> telas do menu)
 *                                 ROTA_AREAS  (tela   -> áreas que a API exige)
 *   backend   src/common/rbac/acesso.config.ts   ACESSO_AREAS (perfil -> áreas)
 *
 * A pergunta que ele responde é sempre a mesma: existe alguma tela que o MENU
 * oferece e a API NEGA? Isso é o bug que o usuário sente ("clico e dá erro").
 *
 *   node scripts/rbac-check.js            só a verificação
 *   node scripts/rbac-check.js --mapa     + o menu que cada perfil enxerga
 *
 * Sai com código 1 se encontrar divergência — dá para plugar no CI depois.
 */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const ts = fs.readFileSync(path.join(raiz, 'src/common/rbac/acesso.config.ts'), 'utf8');

/** Extrai um literal `const NOME = {...};` / `[...];` do index.html e avalia. */
function literal(nome, abre, fecha) {
  const i = html.indexOf(`const ${nome} = ${abre}`);
  if (i < 0) throw new Error(`não achei "const ${nome}" em public/index.html`);
  const j = html.indexOf(`\n${fecha};`, i);
  if (j < 0) throw new Error(`não achei o fim de ${nome}`);
  const corpo = html.slice(i + `const ${nome} = `.length, j + 1 + fecha.length);
  return eval(`(${corpo})`); // literal do próprio repositório, não entrada externa
}

const ACCESS = literal('ACCESS', '{', '}');
const ROTA_AREAS = literal('ROTA_AREAS', '{', '}');
const NAVDEF = literal('NAVDEF', '[', ']');

// ---- backend: as áreas válidas (o type Area) e o mapa perfil -> áreas ----
const tipoArea = ts.slice(ts.indexOf('export type Area ='), ts.indexOf('export const ALL_AREAS'));
const AREAS_VALIDAS = new Set([...tipoArea.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));

const blocoMapa = ts.slice(ts.indexOf('ACESSO_AREAS'), ts.indexOf('export function'));
const ACESSO_AREAS = {};
for (const m of blocoMapa.matchAll(/^\s{2}(\w+):\s*(ALL_AREAS|\[[\s\S]*?\]),$/gm)) {
  ACESSO_AREAS[m[1]] = m[2] === 'ALL_AREAS' ? '*' : [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const rotasDoMenu = new Set(NAVDEF.flatMap(([, itens]) => itens.map((it) => it[0])));
const problemas = [];
const avisos = [];

// 1) Toda rota concedida no ACCESS precisa existir no menu.
for (const [perfil, rotas] of Object.entries(ACCESS)) {
  if (rotas === '*') continue;
  for (const r of rotas) {
    if (!rotasDoMenu.has(r)) problemas.push(`${perfil}: concede "${r}", que não existe no NAVDEF`);
  }
}

// 2) Toda tela do menu deveria declarar as áreas que exige (ou ser local de propósito).
const SEM_API = new Set(['regras']); // telas 100% client-side
for (const r of rotasDoMenu) {
  if (!ROTA_AREAS[r] && !SEM_API.has(r)) avisos.push(`tela "${r}" não está em ROTA_AREAS (será tratada como liberada)`);
}

// 3) As áreas citadas no ROTA_AREAS precisam existir no backend.
for (const [rota, areas] of Object.entries(ROTA_AREAS)) {
  for (const a of areas) {
    if (!AREAS_VALIDAS.has(a)) problemas.push(`ROTA_AREAS["${rota}"] cita a área "${a}", que não existe no type Area`);
  }
}

// 4) O CHECK QUE IMPORTA: menu promete, API nega.
for (const [perfil, rotas] of Object.entries(ACCESS)) {
  if (rotas === '*') continue;
  const areasDoPerfil = ACESSO_AREAS[perfil];
  if (!areasDoPerfil) { problemas.push(`perfil "${perfil}" existe no frontend e não no ACESSO_AREAS`); continue; }
  if (areasDoPerfil === '*') continue;
  for (const r of rotas) {
    const exige = ROTA_AREAS[r];
    if (!exige) continue;
    if (!exige.some((a) => areasDoPerfil.includes(a))) {
      problemas.push(`${perfil}: menu mostra "${r}" mas a API exige [${exige.join('|')}] e o perfil tem [${areasDoPerfil.join(', ')}]`);
    }
  }
}

// 5) Perfil do backend que o frontend desconhece.
for (const perfil of Object.keys(ACESSO_AREAS)) {
  if (!(perfil in ACCESS)) problemas.push(`perfil "${perfil}" existe no backend e não no ACCESS do frontend`);
}

// ---- --mapa: o menu real de cada perfil, família por família ----
if (process.argv.includes('--mapa')) {
  const SIGLA = literal('NAV_SIGLA', '{', '}');
  for (const [perfil, rotas] of Object.entries(ACCESS)) {
    const pode = (r) => rotas === '*' || rotas.includes(r);
    const fams = NAVDEF.map(([g, itens]) => [g, itens.filter((it) => pode(it[0]))]).filter(([, v]) => v.length);
    const telas = fams.reduce((s, [, v]) => s + v.length, 0);
    console.log(`\n${'='.repeat(70)}\n${perfil.toUpperCase()}  ·  ${fams.length} família(s) · ${telas} tela(s)`);
    for (const [g, v] of fams) console.log(`  [${SIGLA[g] || '??'}] ${g}\n       ${v.map((it) => it[1]).join(' · ')}`);
    const ocultas = NAVDEF.filter(([, itens]) => !itens.some((it) => pode(it[0]))).map(([g]) => g);
    if (ocultas.length) console.log('  oculto: ' + ocultas.join(', '));
  }
  console.log('\n' + '='.repeat(70));
}

for (const a of avisos) console.log('aviso  ' + a);
for (const p of problemas) console.log('ERRO   ' + p);
console.log(`\n${Object.keys(ACCESS).length} perfis · ${rotasDoMenu.size} telas · ${AREAS_VALIDAS.size} áreas`);
console.log(problemas.length ? `${problemas.length} divergência(s).` : 'RBAC coerente: nenhuma tela do menu é negada pela API.');
process.exit(problemas.length ? 1 : 0);
