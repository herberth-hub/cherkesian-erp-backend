const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "clienteUnidadeId" INTEGER;`);
  await p.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Contrato_clienteUnidadeId_fkey') THEN
      ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_clienteUnidadeId_fkey" FOREIGN KEY ("clienteUnidadeId") REFERENCES "ClienteUnidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF; END $$;`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Contrato_clienteUnidadeId_idx" ON "Contrato"("clienteUnidadeId");`);
  console.log('Contrato.clienteUnidadeId (+FK, +index) OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
