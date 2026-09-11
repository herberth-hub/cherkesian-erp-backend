const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{ await p.$executeRawUnsafe(`ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "dadosBancarios" TEXT;`); console.log('Fornecedor.dadosBancarios OK'); await p.$disconnect(); })().catch(e=>{console.error(e.message);process.exit(1);});
