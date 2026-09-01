const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  await p.$executeRawUnsafe(`ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "impostoVendaPercent" DECIMAL(5,2);`);
  await p.$executeRawUnsafe(`ALTER TABLE "ContaReceber" ADD COLUMN IF NOT EXISTS "comissaoGerada" BOOLEAN NOT NULL DEFAULT false;`);
  // HC Quality (#3) = 11%
  await p.$executeRawUnsafe(`UPDATE "Filial" SET "impostoVendaPercent"=11 WHERE id=3;`);
  const fs=await p.filial.findMany({select:{id:true,nome:true,impostoVendaPercent:true}});
  console.log('Filiais imposto venda:'); fs.forEach(f=>console.log(`  #${f.id} ${f.nome}: ${f.impostoVendaPercent==null?'(não definido)':f.impostoVendaPercent+'%'}`));
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
