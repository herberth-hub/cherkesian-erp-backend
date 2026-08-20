require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  const n = await p.$executeRawUnsafe(`UPDATE "Pedido" SET "clienteId"=40, "clienteUnidadeId"=12, "clienteGrupo"='SANTA CASA DE SBC' WHERE "clienteId"=80`);
  console.log('>>> pedidos movidos:', n, '-> cliente #40 / unidade #12 (LARANJEIRAS)');
  // verifica
  const peds = await p.pedido.findMany({ where:{ clienteUnidadeId:12 }, select:{ numero:true, clienteId:true, clienteUnidadeId:true } });
  console.log('Agora na unidade #12:', peds.map(x=>x.numero).join(', '));
  const [nped,nrec,nexp] = await Promise.all([
    p.pedido.count({where:{clienteId:80}}), p.contaReceber.count({where:{clienteId:80}}), p.expedicao.count({where:{clienteId:80}}),
  ]);
  console.log(`Restam no #80 -> pedidos=${nped} · contasReceber=${nrec} · expedicoes=${nexp}`);
  console.log((nped+nrec+nexp===0)?'CLIENTE #80 PRONTO PARA EXCLUIR ✓':'ainda ha vinculos');
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
