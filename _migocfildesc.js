const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "OrdemCompra" ADD COLUMN IF NOT EXISTS "filialId" INTEGER;`);
  await p.$executeRawUnsafe(`ALTER TABLE "OrdemCompra" ADD COLUMN IF NOT EXISTS "descricaoFornecedor" TEXT;`);
  await p.$executeRawUnsafe(`ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "descricaoFornecedor" TEXT;`);
  console.log('OC.filialId + OC.descricaoFornecedor + Produto.descricaoFornecedor OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
