/**
 * Move anexos do banco para o bucket, UMA COLUNA POR VEZ.
 *
 * A coluna passa a guardar `arq:<chave>` em vez do data URI. Migrar por coluna
 * é de propósito: cada uma tem os seus leitores (tela, PDF, portal), então só
 * se migra o que já sabe ler a referência.
 *
 *   node scripts/migrar-anexos-storage.js --coluna=Produto.mapaDtf
 *   node scripts/migrar-anexos-storage.js --coluna=Produto.mapaDtf --aplicar
 *   node scripts/migrar-anexos-storage.js --coluna=Produto.mapaDtf --aplicar --limite=5
 *
 * Sem --aplicar só mostra o que faria. Com --backup=<pasta> grava uma cópia de
 * cada anexo em disco antes de trocar a coluna.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const arg = (n, padrao = '') => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : padrao;
};
const APLICAR = process.argv.includes('--aplicar');
const COLUNA = arg('coluna');
const LIMITE = Number(arg('limite', '0')) || 0;
const BACKUP = arg('backup');

// Pasta no bucket por coluna — mantém o balde legível.
const PASTAS = {
  'Produto.mapaDtf': 'mapas',
  'Produto.fotoModelo': 'produtos',
  'Produto.fotoModelagem': 'modelagens',
  'Produto.fichaCliente': 'fichas-cliente',
  'Produto.logoVetor': 'logos',
  'Produto.arquivoModelagem': 'modelagens',
  'ProdutoCor.mockupFrente': 'mockups',
  'ProdutoCor.mockupCostas': 'mockups',
  'Pedido.ocArquivo': 'ordens-compra',
  'Expedicao.canhotoImg': 'canhotos',
  'ContaPagar.boleto': 'boletos',
  'AnomaliaEvento.anexo': 'anomalias',
};

const EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
  'application/zip': 'zip', 'application/xml': 'xml', 'text/xml': 'xml',
};
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

function cliente() {
  const endpoint = process.env.ARQUIVOS_ENDPOINT;
  const chave = process.env.ARQUIVOS_CHAVE;
  const secreta = process.env.ARQUIVOS_SEGREDO;
  const bucket = process.env.ARQUIVOS_BUCKET;
  if (!endpoint || !chave || !secreta || !bucket) return null;
  return {
    bucket,
    s3: new S3Client({
      region: process.env.ARQUIVOS_REGIAO || 'auto',
      endpoint,
      credentials: { accessKeyId: chave, secretAccessKey: secreta },
      forcePathStyle: true,
    }),
  };
}

(async () => {
  if (!COLUNA || !PASTAS[COLUNA]) {
    console.error('Informe --coluna=<Tabela.coluna>. Conhecidas:');
    for (const k of Object.keys(PASTAS)) console.error('   ' + k);
    process.exit(1);
  }
  const [tabela, col] = COLUNA.split('.');
  const prisma = new PrismaClient();

  const resumo = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n, COALESCE(sum(length("${col}")),0)::bigint AS bytes
       FROM "${tabela}" WHERE "${col}" LIKE 'data:%'`,
  );
  const { n, bytes } = resumo[0];
  console.log(`${COLUNA}: ${n} anexo(s) no banco, ${mb(Number(bytes))}`);
  if (!n) { await prisma.$disconnect(); return; }

  const destino = cliente();
  if (!destino) {
    console.log('\nStorage NAO configurado. Defina no ambiente:');
    console.log('   ARQUIVOS_ENDPOINT, ARQUIVOS_CHAVE, ARQUIVOS_SEGREDO, ARQUIVOS_BUCKET');
    console.log('(sem isso o script só mede, como agora)');
    await prisma.$disconnect();
    return;
  }

  const linhas = await prisma.$queryRawUnsafe(
    `SELECT id, "${col}" AS valor FROM "${tabela}"
      WHERE "${col}" LIKE 'data:%' ORDER BY id${LIMITE ? ` LIMIT ${LIMITE}` : ''}`,
  );
  console.log(`vai mover ${linhas.length} linha(s)${APLICAR ? '' : ' (modo conferência)'}`);
  if (BACKUP) fs.mkdirSync(BACKUP, { recursive: true });

  let movidos = 0, movidosBytes = 0, erros = 0;
  for (const linha of linhas) {
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(linha.valor);
    if (!m) { console.log(`  id ${linha.id}: não é data URI, pulado`); continue; }
    const tipo = m[1];
    const buf = Buffer.from(m[2], 'base64');
    const chave = `${PASTAS[COLUNA]}/${linha.id}-${crypto.randomBytes(5).toString('hex')}.${EXT[tipo] ?? 'bin'}`;

    if (!APLICAR) {
      console.log(`  id ${linha.id}: ${mb(buf.length)} ${tipo} -> ${chave}`);
      movidosBytes += buf.length; movidos++;
      continue;
    }
    try {
      if (BACKUP) fs.writeFileSync(path.join(BACKUP, `${tabela}-${col}-${linha.id}.${EXT[tipo] ?? 'bin'}`), buf);
      await destino.s3.send(new PutObjectCommand({ Bucket: destino.bucket, Key: chave, Body: buf, ContentType: tipo }));
      // Confere que chegou ANTES de soltar o original do banco.
      await destino.s3.send(new HeadObjectCommand({ Bucket: destino.bucket, Key: chave }));
      await prisma.$executeRawUnsafe(`UPDATE "${tabela}" SET "${col}" = $1 WHERE id = $2`, `arq:${chave}`, linha.id);
      movidos++; movidosBytes += buf.length;
      process.stdout.write(`\r  movidos: ${movidos}/${linhas.length} (${mb(movidosBytes)})   `);
    } catch (e) {
      erros++;
      console.log(`\n  id ${linha.id}: FALHOU — ${e.message}`);
    }
  }
  console.log(`\n${APLICAR ? 'movidos' : 'moveria'}: ${movidos} · ${mb(movidosBytes)}${erros ? ` · ${erros} erro(s)` : ''}`);
  if (APLICAR) {
    const sobra = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${tabela}" WHERE "${col}" LIKE 'data:%'`,
    );
    console.log(`ainda em base64 nesta coluna: ${sobra[0].n}`);
    console.log('Rode VACUUM FULL ou aguarde o autovacuum para o espaço voltar ao disco.');
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); process.exit(1); });
