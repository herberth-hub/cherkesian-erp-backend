#!/usr/bin/env node
'use strict';

const { executar } = require('../src/cli');

executar(process.argv.slice(2)).then(({ codigo, saida }) => {
  (codigo === 0 ? process.stdout : process.stderr).write(saida);
  process.exitCode = codigo;
});
