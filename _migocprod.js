const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "OrdemCompra" ADD COLUMN IF NOT EXISTS "produtoId" INTEGER;`);
  console.log('OrdemCompra.produtoId OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
