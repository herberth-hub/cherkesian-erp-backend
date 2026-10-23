/**
 * Quanto do banco é anexo em base64, por tabela e coluna.
 *
 * Só LÊ. Serve para decidir o que vale mover para storage externo e para medir
 * o antes/depois da migração.
 *
 *   node scripts/medir-anexos.js
 */
const { PrismaClient } = require('@prisma/client');

// tabela -> colunas que guardam data URI / base64
const ALVOS = {
  Empresa: ['logo'],
  Filial: ['logo'],
  Fornecedor: ['catalogo'],
  // logosVetor é Json (lista de {data,nome}), por isso entra como texto do Json.
  Produto: ['fotoModelo', 'fotoModelagem', 'arquivoModelagem', 'logoVetor', 'fichaCliente', 'mapaDtf'],
  ProdutoCor: ['mockupFrente', 'mockupCostas'],
  Pedido: ['ocArquivo'],
  Expedicao: ['canhotoImg'],
  ContaPagar: ['boleto'],
  AnomaliaEvento: ['anexo'],
};
/** Colunas Json: medem pelo texto do Json. */
const ALVOS_JSON = { Produto: ['logosVetor'] };

const mb = (n) => (Number(n) / 1024 / 1024).toFixed(1) + ' MB';

(async () => {
  const prisma = new PrismaClient();
  const linhas = [];
  let total = 0;

  for (const [tabela, colunas] of Object.entries(ALVOS)) {
    for (const col of colunas) {
      let r;
      try {
        r = await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS linhas, COALESCE(sum(length("${col}")),0)::bigint AS bytes,
                  COALESCE(max(length("${col}")),0)::int AS maior
             FROM "${tabela}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`,
        );
      } catch (e) {
        linhas.push({ tabela, col, erro: String(e.message).split('\n')[0].slice(0, 60) });
        continue;
      }
      const { linhas: n, bytes, maior } = r[0];
      if (!Number(bytes)) continue;
      total += Number(bytes);
      linhas.push({ tabela, col, n, bytes: Number(bytes), maior: Number(maior) });
    }
  }

  for (const [tabela, colunas] of Object.entries(ALVOS_JSON)) {
    for (const col of colunas) {
      try {
        const r = await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS linhas, COALESCE(sum(length("${col}"::text)),0)::bigint AS bytes,
                  COALESCE(max(length("${col}"::text)),0)::int AS maior
             FROM "${tabela}" WHERE "${col}" IS NOT NULL`,
        );
        const { linhas: n, bytes, maior } = r[0];
        if (!Number(bytes)) continue;
        total += Number(bytes);
        linhas.push({ tabela, col, n, bytes: Number(bytes), maior: Number(maior) });
      } catch (e) {
        linhas.push({ tabela, col, erro: String(e.message).split('\n')[0].slice(0, 60) });
      }
    }
  }

  linhas.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  console.log('coluna'.padEnd(34) + 'linhas'.padStart(8) + 'total'.padStart(12) + 'maior'.padStart(12));
  console.log('-'.repeat(66));
  for (const l of linhas) {
    if (l.erro) { console.log(`${(l.tabela + '.' + l.col).padEnd(34)}  (${l.erro})`); continue; }
    console.log(
      (l.tabela + '.' + l.col).padEnd(34) +
      String(l.n).padStart(8) +
      mb(l.bytes).padStart(12) +
      ((l.maior / 1024).toFixed(0) + ' KB').padStart(12),
    );
  }
  console.log('-'.repeat(66));
  console.log('TOTAL em anexos'.padEnd(34) + ''.padStart(8) + mb(total).padStart(12));

  // Tamanho do banco todo, para por o número em perspectiva.
  try {
    const t = await prisma.$queryRawUnsafe(`SELECT pg_database_size(current_database())::bigint AS b`);
    const banco = Number(t[0].b);
    console.log('TAMANHO DO BANCO'.padEnd(34) + ''.padStart(8) + mb(banco).padStart(12));
    console.log(`\nanexos = ${((total / banco) * 100).toFixed(0)}% do banco`);
  } catch (e) { /* sem permissão, tudo bem */ }

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); process.exit(1); });
