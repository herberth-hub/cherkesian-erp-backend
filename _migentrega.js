const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "instrucoesEntrega" JSONB;`);
  await p.$executeRawUnsafe(`ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS "padraoEntrega" JSONB;`);
  console.log('Pedido.instrucoesEntrega + Cliente.padraoEntrega OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
