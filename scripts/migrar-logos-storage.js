/**
 * Move os LOGOS VETORIZADOS do produto para o bucket.
 *
 * Script à parte porque o anexo não está numa coluna: ele mora dentro do Json
 * `Produto.logosVetor` — uma lista [{data, nome}] — e o campo antigo
 * `Produto.logoVetor` é só um espelho do primeiro item. Os dois são
 * reescritos juntos, do mesmo jeito que o serviço faz ao salvar o produto.
 *
 *   node -r dotenv/config scripts/migrar-logos-storage.js
 *   node -r dotenv/config scripts/migrar-logos-storage.js --aplicar
 *   node -r dotenv/config scripts/migrar-logos-storage.js --aplicar --backup=<pasta>
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const APLICAR = process.argv.includes('--aplicar');
const BACKUP = (process.argv.find((a) => a.startsWith('--backup=')) ?? '').replace('--backup=', '');
const EMPRESA = Number(process.env.EMPRESA_ID || 1);

const EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'application/postscript': 'eps',
  'application/zip': 'zip', 'application/octet-stream': 'bin',
};
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

function cliente() {
  const { ARQUIVOS_ENDPOINT, ARQUIVOS_CHAVE, ARQUIVOS_SEGREDO, ARQUIVOS_BUCKET } = process.env;
  if (!ARQUIVOS_ENDPOINT || !ARQUIVOS_CHAVE || !ARQUIVOS_SEGREDO || !ARQUIVOS_BUCKET) return null;
  return {
    bucket: ARQUIVOS_BUCKET,
    s3: new S3Client({
      region: process.env.ARQUIVOS_REGIAO || 'auto',
      endpoint: ARQUIVOS_ENDPOINT,
      credentials: { accessKeyId: ARQUIVOS_CHAVE, secretAccessKey: ARQUIVOS_SEGREDO },
      forcePathStyle: true,
    }),
  };
}

(async () => {
  const prisma = new PrismaClient();
  const produtos = await prisma.produto.findMany({
    where: { empresaId: EMPRESA, OR: [{ logosVetor: { not: Prisma_null() } }, { logoVetor: { not: null } }] },
    select: { id: true, codigo: true, logosVetor: true, logoVetor: true, logoVetorNome: true },
    orderBy: { id: 'asc' },
  });

  // Normaliza: lista do Json; sem ela, o campo antigo vira lista de um item.
  const alvos = [];
  let bytesTotal = 0;
  for (const p of produtos) {
    const lista = Array.isArray(p.logosVetor) && p.logosVetor.length
      ? p.logosVetor.map((l) => ({ ...l }))
      : (p.logoVetor ? [{ data: p.logoVetor, nome: p.logoVetorNome || 'logo' }] : []);
    const pendentes = lista.filter((l) => String(l?.data ?? '').startsWith('data:'));
    if (!pendentes.length) continue;
    for (const l of pendentes) bytesTotal += String(l.data).length;
    alvos.push({ ...p, lista, pendentes: pendentes.length });
  }

  console.log(`produtos com logo: ${produtos.length} · a migrar: ${alvos.length} · ${mb(bytesTotal)}`);
  for (const a of alvos) console.log(`  ${a.codigo}: ${a.pendentes} logo(s) de ${a.lista.length}`);

  const destino = cliente();
  if (!destino) { console.log('\nStorage não configurado (ARQUIVOS_*). Nada foi movido.'); await prisma.$disconnect(); return; }
  if (!APLICAR) { console.log('\n(modo conferência — rode com --aplicar para valer)'); await prisma.$disconnect(); return; }
  if (BACKUP) fs.mkdirSync(BACKUP, { recursive: true });

  let movidos = 0, bytesMovidos = 0, erros = 0;
  for (const a of alvos) {
    try {
      for (const item of a.lista) {
        const s = String(item?.data ?? '');
        const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(s);
        if (!m) continue; // já é `arq:` ou está vazio
        const buf = Buffer.from(m[2], 'base64');
        const chave = `logos/${a.id}-${crypto.randomBytes(5).toString('hex')}.${EXT[m[1]] ?? 'bin'}`;
        if (BACKUP) fs.writeFileSync(path.join(BACKUP, `Produto-logo-${a.id}-${movidos}.${EXT[m[1]] ?? 'bin'}`), buf);
        await destino.s3.send(new PutObjectCommand({ Bucket: destino.bucket, Key: chave, Body: buf, ContentType: m[1] }));
        await destino.s3.send(new HeadObjectCommand({ Bucket: destino.bucket, Key: chave }));
        item.data = `arq:${chave}`;
        movidos++; bytesMovidos += buf.length;
      }
      // Grava a lista e o espelho do primeiro item, como o serviço faz.
      await prisma.produto.update({
        where: { id: a.id },
        data: {
          logosVetor: a.lista,
          logoVetor: a.lista[0]?.data ?? null,
          logoVetorNome: a.lista[0]?.nome ?? null,
        },
      });
      process.stdout.write(`\r  movidos: ${movidos} (${mb(bytesMovidos)})   `);
    } catch (e) {
      erros++;
      console.log(`\n  ${a.codigo}: FALHOU — ${e.message}`);
    }
  }
  console.log(`\nlogos movidos: ${movidos} · ${mb(bytesMovidos)}${erros ? ` · ${erros} produto(s) com erro` : ''}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

/** `not: null` em coluna Json pede o JsonNull do Prisma, não o null do JS. */
function Prisma_null() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Prisma } = require('@prisma/client');
  return Prisma.JsonNull;
}
