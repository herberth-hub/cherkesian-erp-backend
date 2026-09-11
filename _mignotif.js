const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Notificacao" (
    "id" SERIAL PRIMARY KEY,
    "empresaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "areas" JSONB NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "refTipo" TEXT,
    "refId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Notificacao_empresaId_criadoEm_idx" ON "Notificacao" ("empresaId","criadoEm");`);
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NotificacaoCiencia" (
    "id" SERIAL PRIMARY KEY,
    "notificacaoId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "cienteEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "NotificacaoCiencia_notificacaoId_usuarioId_key" ON "NotificacaoCiencia" ("notificacaoId","usuarioId");`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NotificacaoCiencia_usuarioId_idx" ON "NotificacaoCiencia" ("usuarioId");`);
  // FK com cascade (ignora se já existir)
  try { await p.$executeRawUnsafe(`ALTER TABLE "NotificacaoCiencia" ADD CONSTRAINT "NotificacaoCiencia_notificacaoId_fkey" FOREIGN KEY ("notificacaoId") REFERENCES "Notificacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;`); } catch(e){ if(!/already exists/i.test(e.message)) throw e; }
  console.log('Notificacao + NotificacaoCiencia OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
