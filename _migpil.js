const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "Piloto" ALTER COLUMN "pedidoId" DROP NOT NULL;`);
  await p.$executeRawUnsafe(`ALTER TABLE "Piloto" ALTER COLUMN "clienteId" DROP NOT NULL;`);
  for(const [c,t] of [['empresaId','INTEGER'],['clienteNome','TEXT'],['modelagem','TEXT'],['artigo','TEXT'],['marca','TEXT'],['cor','TEXT'],['setor','TEXT']]){
    await p.$executeRawUnsafe(`ALTER TABLE "Piloto" ADD COLUMN IF NOT EXISTS "${c}" ${t};`);
  }
  // backfill empresaId dos pilotos existentes a partir do pedido
  await p.$executeRawUnsafe(`UPDATE "Piloto" pl SET "empresaId" = pe."empresaId" FROM "Pedido" pe WHERE pl."pedidoId" = pe.id AND pl."empresaId" IS NULL;`);
  const n=await p.piloto.count({ where:{ empresaId:null } });
  console.log('Piloto ajustado. Ainda sem empresaId:', n);
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
