/**
 * Verifica a SINTAXE do <script> embutido no index.html (e no portal.html).
 *
 * O frontend é um arquivo só, com um IIFE só: um parêntese a menos em qualquer
 * lugar não quebra uma tela — quebra TODAS, e o navegador só reclama em tempo
 * de execução, depois de publicado. Este script pega isso antes do deploy.
 *
 *   node scripts/checa-js.js                       # index.html + portal.html
 *   node scripts/checa-js.js public/index.html     # um arquivo específico
 *
 * Sai com código 1 se achar erro — é o que trava o CI.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..');
const alvos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['public/index.html', 'public/portal.html'];

let erros = 0;
let blocosTotal = 0;

for (const rel of alvos) {
  const arq = path.isAbsolute(rel) ? rel : path.join(raiz, rel);
  if (!fs.existsSync(arq)) {
    console.error(`ERRO: ${rel} não existe.`);
    erros++;
    continue;
  }
  const html = fs.readFileSync(arq, 'utf8');
  // Só os <script> SEM src: os com src são arquivos à parte, já cobertos
  // quando (e se) forem passados como alvo.
  const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocosTotal += blocos.length;
  blocos.forEach((m, i) => {
    const linha = html.slice(0, m.index).split('\n').length;
    try {
      new vm.Script(m[1], { filename: `${rel}:bloco${i + 1}` });
    } catch (e) {
      erros++;
      console.error(`ERRO de sintaxe em ${rel}, bloco ${i + 1} (começa na linha ${linha}): ${e.message}`);
    }
  });
  console.log(`${rel}: ${blocos.length} bloco(s) <script> inline`);
}

console.log(erros ? `${erros} erro(s) de sintaxe.` : `${blocosTotal} bloco(s) verificados, nenhum erro de sintaxe.`);
process.exit(erros ? 1 : 0);
