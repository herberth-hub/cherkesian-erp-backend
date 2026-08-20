require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  const peds = await p.pedido.findMany({ where:{ clienteId:80 }, select:{ id:true, numero:true, etapa:true } });
  console.log('Pedidos do #80 (', peds.length, '):');
  for(const pd of peds){
    const nfs = await p.notaFiscal.findMany({ where:{ pedidoId:pd.id }, select:{ numero:true, status:true } });
    console.log(`  ${pd.numero} (id ${pd.id}) etapa=${pd.etapa} | NFs: ${nfs.map(n=>n.numero+'['+n.status+']').join(', ')||'nenhuma'}`);
  }
  // MOVE
  const r = await p.pedido.updateMany({ where:{ clienteId:80 }, data:{ clienteId:40, clienteUnidadeId:12, clienteGrupo:'SANTA CASA DE SBC' } });
  console.log('\n>>> Movidos', r.count, 'pedido(s) para cliente #40 / unidade #12 (LARANJEIRAS).');
  // Checa referencias remanescentes ao #80
  const [nped,nrec,nexp,ncred] = await Promise.all([
    p.pedido.count({where:{clienteId:80}}),
    p.contaReceber.count({where:{clienteId:80}}),
    p.expedicao.count({where:{clienteId:80}}),
    p.consultaCredito.count({where:{clienteId:80}}).catch(()=>0),
  ]);
  console.log(`Restam no #80 -> pedidos=${nped} · contasReceber=${nrec} · expedicoes=${nexp} · consultasCredito=${ncred}`);
  console.log(nped+nrec+nexp===0 ? 'CLIENTE #80 PRONTO PARA EXCLUIR ✓' : 'ainda ha vinculos');
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
