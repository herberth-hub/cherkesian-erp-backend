#!/usr/bin/env node
'use strict';

/** Gera schemas/<entidade>.schema.json a partir de src/schemas.js (fonte única). */

const fs = require('fs');
const path = require('path');
const { SCHEMAS } = require('../src/schemas');

const dir = path.join(__dirname, '..', 'schemas');
fs.mkdirSync(dir, { recursive: true });
for (const [nome, schema] of Object.entries(SCHEMAS)) {
  fs.writeFileSync(path.join(dir, `${nome}.schema.json`), JSON.stringify(schema, null, 2) + '\n');
}
console.log(`${Object.keys(SCHEMAS).length} schemas gerados em ${path.relative(process.cwd(), dir) || '.'}`);
