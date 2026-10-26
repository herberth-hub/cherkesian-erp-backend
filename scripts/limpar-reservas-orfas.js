/**
 * Reserva ÓRFÃ: etiqueta com status `reservado` que não tem pedido nem
 * expedição por trás.
 *
 * De onde vem: etiqueta gerada com destino "expedição" numa expedição que
 * nunca foi criada, e estorno de expedição — que devolve a peça para
 * `reservado` e zera o `expedicaoId`, deixando exatamente este estado.
 *
 * O que ela causa: o cartão "Reservado · separado p/ expedição" conta peça que
 * não está separada para nada, e a peça não aparece como disponível para
 * vender nem para endereçar.
 *
 * A limpeza NÃO apaga e NÃO dá baixa: devolve a etiqueta ao fluxo normal de
 * estoque. Peça com endereço volta para `em_estoque`; sem endereço volta para
 * `aguardando_endereco`, que é a fila de quem precisa ser guardado.
 *
 *   node -r dotenv/config scripts/limpar-reservas-orfas.js
 *   node -r dotenv/config scripts/limpar-reservas-orfas.js --aplicar
 *   node -r dotenv/config scripts/limpar-reservas-orfas.js --aplicar --produto=PRD-CAL-0003
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const PRODUTO = (process.argv.find((a) => a.startsWith('--produto=')) ?? '').replace('--produto=', '');
const USUARIO = (process.argv.find((a) => a.startsWith('--usuario=')) ?? '').replace('--usuario=', '') || 'limpeza-script';

(async () => {
  const prisma = new PrismaClient();

  let produtoId;
  if (PRODUTO) {
    const p = await prisma.produto.findFirst({ where: { codigo: PRODUTO }, select: { id: true } });
    if (!p) { console.error(`Produto ${PRODUTO} não encontrado.`); process.exit(1); }
    produtoId = p.id;
  }

  const orfas = await prisma.unidadeEstoque.findMany({
    where: {
      status: 'reservado',
      pedidoId: null,
      expedicaoId: null,
      ...(produtoId ? { produtoId } : {}),
    },
    select: { id: true, codigo: true, produtoId: true, descricao: true, cor: true, coluna: true, andar: true, criadoEm: true },
  });

  if (!orfas.length) { console.log('Nenhuma reserva órfã.'); await prisma.$disconnect(); return; }

  const comEndereco = orfas.filter((u) => u.coluna && u.andar != null);
  const semEndereco = orfas.filter((u) => !(u.coluna && u.andar != null));

  const ids = [...new Set(orfas.map((u) => u.produtoId).filter(Boolean))];
  const prods = ids.length ? await prisma.produto.findMany({ where: { id: { in: ids } }, select: { id: true, codigo: true } }) : [];
  const cod = new Map(prods.map((p) => [p.id, p.codigo]));
  const porProduto = {};
  for (const u of orfas) {
    const k = cod.get(u.produtoId) ?? `#${u.produtoId ?? 'sem produto'}`;
    porProduto[k] = (porProduto[k] ?? 0) + 1;
  }

  console.log(`reservas órfãs: ${orfas.length}`);
  console.log(`  com endereço  -> voltam para "em estoque"        : ${comEndereco.length}`);
  console.log(`  sem endereço  -> voltam para "aguardando endereço": ${semEndereco.length}`);
  console.log('\npor produto:');
  Object.entries(porProduto).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));

  if (!APLICAR) { console.log('\n(modo conferência — rode com --aplicar para valer)'); await prisma.$disconnect(); return; }

  // Duas escritas, não uma por peça: o Neon derruba transação longa.
  let n1 = 0, n2 = 0;
  if (comEndereco.length) {
    const r = await prisma.unidadeEstoque.updateMany({
      where: { id: { in: comEndereco.map((u) => u.id) } },
      data: { status: 'em_estoque' },
    });
    n1 = r.count;
  }
  if (semEndereco.length) {
    const r = await prisma.unidadeEstoque.updateMany({
      where: { id: { in: semEndereco.map((u) => u.id) } },
      data: { status: 'aguardando_endereco' },
    });
    n2 = r.count;
  }
  await prisma.log.create({
    data: {
      usuario: USUARIO,
      acao: 'estoque.reserva.limpeza',
      detalhe: `${n1 + n2} reserva(s) órfã(s) devolvidas ao estoque${PRODUTO ? ' · ' + PRODUTO : ''} (${n1} em estoque, ${n2} aguardando endereço)`,
      entidade: 'UnidadeEstoque',
    },
  }).catch(() => undefined);
  console.log(`\ndevolvidas: ${n1 + n2} (${n1} em estoque · ${n2} aguardando endereço)`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
