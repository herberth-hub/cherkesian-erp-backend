const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{ await p.$executeRawUnsafe(`ALTER TABLE "OrdemCompra" ADD COLUMN IF NOT EXISTS "codigoFornecedor" TEXT;`); console.log('OrdemCompra.codigoFornecedor OK'); await p.$disconnect(); })().catch(e=>{console.error(e.message);process.exit(1);});
