const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{ await p.$executeRawUnsafe(`ALTER TABLE "OrdemCompra" ADD COLUMN IF NOT EXISTS "atrasoAvisadoEm" TIMESTAMP(3);`); console.log('OrdemCompra.atrasoAvisadoEm OK'); await p.$disconnect(); })().catch(e=>{console.error(e.message);process.exit(1);});
