const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{ await p.$executeRawUnsafe(`ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "codigoFornecedor" TEXT;`); console.log('Produto.codigoFornecedor OK'); await p.$disconnect(); })().catch(e=>{console.error(e.message);process.exit(1);});
