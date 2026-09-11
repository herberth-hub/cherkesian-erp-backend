const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{ await p.$executeRawUnsafe(`ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "cBenefBonificacao" TEXT;`); console.log('Filial.cBenefBonificacao OK'); await p.$disconnect(); })().catch(e=>{console.error(e.message);process.exit(1);});
