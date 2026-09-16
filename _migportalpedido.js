const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "origem" TEXT;`);
  await p.$executeRawUnsafe(`ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "portalChave" TEXT;`);
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Pedido_portalChave_key" ON "Pedido"("portalChave");`);
  console.log('Pedido.origem + Pedido.portalChave (unique) OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
