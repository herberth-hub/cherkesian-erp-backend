'use strict';

/**
 * Validador de JSON Schema (subconjunto do draft 2020-12) sem dependências.
 * Suporta: type (inclusive lista), required, properties, additionalProperties,
 * enum, const, pattern, minimum, maximum, minLength, items, anyOf, format
 * (date, date-time). É o suficiente para os schemas em ../schemas.
 */

const FORMATOS = {
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`)),
  'date-time': (v) => /^\d{4}-\d{2}-\d{2}T/.test(v) && !isNaN(Date.parse(v)),
};

function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function confereTipo(v, tipo) {
  const t = tipoDe(v);
  if (tipo === 'number') return t === 'number' || t === 'integer';
  return t === tipo;
}

function validar(schema, valor, caminho = '$') {
  const erros = [];
  if (schema.anyOf) {
    const algum = schema.anyOf.some((s) => validar(s, valor, caminho).length === 0);
    if (!algum) erros.push(`${caminho}: não atende a nenhuma das alternativas permitidas`);
  }
  if (schema.type) {
    const tipos = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!tipos.some((t) => confereTipo(valor, t))) {
      erros.push(`${caminho}: esperado ${tipos.join(' | ')}, recebido ${tipoDe(valor)}`);
      return erros;
    }
  }
  if (schema.const !== undefined && valor !== schema.const) {
    erros.push(`${caminho}: deve ser ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(valor)) {
    erros.push(`${caminho}: valor ${JSON.stringify(valor)} fora de [${schema.enum.join(', ')}]`);
  }
  if (typeof valor === 'string') {
    if (schema.minLength != null && valor.trim().length < schema.minLength) {
      erros.push(`${caminho}: texto vazio ou curto demais`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(valor)) {
      erros.push(`${caminho}: formato inválido (${schema.pattern})`);
    }
    if (schema.format && FORMATOS[schema.format] && !FORMATOS[schema.format](valor)) {
      erros.push(`${caminho}: data inválida (${schema.format})`);
    }
  }
  if (typeof valor === 'number') {
    if (schema.minimum != null && valor < schema.minimum) erros.push(`${caminho}: menor que ${schema.minimum}`);
    if (schema.maximum != null && valor > schema.maximum) erros.push(`${caminho}: maior que ${schema.maximum}`);
  }
  if (Array.isArray(valor) && schema.items) {
    valor.forEach((item, i) => erros.push(...validar(schema.items, item, `${caminho}[${i}]`)));
  }
  if (tipoDe(valor) === 'object') {
    for (const campo of schema.required || []) {
      if (!(campo in valor)) erros.push(`${caminho}.${campo}: campo obrigatório ausente`);
    }
    const props = schema.properties || {};
    for (const [campo, v] of Object.entries(valor)) {
      if (props[campo]) erros.push(...validar(props[campo], v, `${caminho}.${campo}`));
      else if (schema.additionalProperties === false) erros.push(`${caminho}.${campo}: campo não previsto no schema`);
    }
  }
  return erros;
}

module.exports = { validar };
