'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Base } = require('../src/store');
const { executar } = require('../src/cli');

const HOJE = '2026-10-29';
const RAIZ = path.resolve(__dirname, '..');
const REPO = path.resolve(RAIZ, '..');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hc-teste-'));
}

/** Base demo isolada (cópia da semente fictícia) em diretório temporário. */
function baseDemo() {
  return Base.abrir({ nome: 'demo', dir: path.join(tmp(), 'demo') });
}

/** Base de produção vazia em diretório temporário. */
function baseVazia() {
  return Base.abrir({ nome: 'producao', dir: path.join(tmp(), 'producao') });
}

/** Executa a CLI contra um diretório de dados; devolve { codigo, saida, json }. */
async function cli(dir, args, { base = 'demo' } = {}) {
  const r = await executar([...args, '--base', base, '--hoje', HOJE], { HC_DATA_DIR: dir });
  let json = null;
  try {
    json = JSON.parse(r.saida);
  } catch {
    // saída textual (relatório, erro)
  }
  return { ...r, json };
}

function lancaCodigo(fn, codigo) {
  try {
    fn();
  } catch (e) {
    if (e.codigo === codigo) return e;
    throw new Error(`esperado erro ${codigo}, recebido ${e.codigo}: ${e.message}`);
  }
  throw new Error(`esperado erro ${codigo}, mas não lançou`);
}

module.exports = { HOJE, RAIZ, REPO, tmp, baseDemo, baseVazia, cli, lancaCodigo };
