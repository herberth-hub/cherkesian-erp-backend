require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  const nf = await p.notaFiscal.findFirst({ where:{ numero:{ contains:'2705' } } });
  console.log('NF', nf?.id, nf?.numero, '| emitida', nf?.emitidaEm, '| pedidoId', nf?.pedidoId);
  if(nf?.pedidoId){
    const ped = await p.pedido.findUnique({ where:{id:nf.pedidoId}, include:{itens:true} });
    console.log('pedido', ped?.numero);
    ped?.itens.forEach(i=>console.log(`  item desc="${i.descricao}" | cor=${JSON.stringify(i.cor)} | grade=${JSON.stringify(i.grade)}`));
    // produto tem cores cadastradas?
    for(const i of (ped?.itens||[])){ if(i.produtoId){ const pr=await p.produto.findUnique({where:{id:i.produtoId}, select:{codigo:true,cor:true,cores:true}}); console.log(`  produto ${pr?.codigo} cor=${JSON.stringify(pr?.cor)} cores=${JSON.stringify(pr?.cores)}`); } }
  }
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
