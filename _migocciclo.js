const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  for(const [c,t] of [['situacao','TEXT'],['enviadaEm','TIMESTAMP(3)'],['compradaEm','TIMESTAMP(3)'],['pagaEm','TIMESTAMP(3)'],['prazoEntregaDias','INTEGER'],['previsaoEntrega','TIMESTAMP(3)']]){
    await p.$executeRawUnsafe(`ALTER TABLE "OrdemCompra" ADD COLUMN IF NOT EXISTS "${c}" ${t};`);
  }
  console.log('OrdemCompra ciclo de compra OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
