/**
 * Baixa de etiqueta SEM LASTRO: a peça existe no sistema e não existe na
 * prateleira.
 *
 * De onde vem: etiqueta emitida num lote de entrada que nunca foi guardado, e
 * reserva que ficou pelo caminho (OP que etiquetou para expedição, expedição
 * estornada, pedido que nunca gerou remessa). Enquanto a etiqueta existe, ela
 * conta como estoque — e o sistema sugere separar peça que ninguém vai achar.
 *
 * NÃO apaga: marca `despachado` com `saidaEm`, igual à baixa em lote da tela, e
 * deixa o motivo no log. A etiqueta continua auditável.
 *
 * Trabalha SÓ com a lista de códigos passada — nunca com filtro amplo.
 *
 *   node -r dotenv/config scripts/baixa-etiquetas-sem-lastro.js --codigos=UN-1,UN-2
 *   node -r dotenv/config scripts/baixa-etiquetas-sem-lastro.js --arquivo=lista.txt --aplicar
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').replace(`--${n}=`, '');
const APLICAR = process.argv.includes('--aplicar');
const MOTIVO = arg('motivo') || 'inventário: peça não existe no físico';
const USUARIO = arg('usuario') || 'inventario-script';

const codigos = [...new Set(
  (arg('codigos') ? arg('codigos').split(',') : [])
    .concat(arg('arquivo') ? fs.readFileSync(arg('arquivo'), 'utf8').split(/\r?\n/) : [])
    .map((c) => c.trim()).filter(Boolean),
)];

(async () => {
  if (!codigos.length) { console.error('Informe --codigos= ou --arquivo=.'); process.exit(1); }
  const prisma = new PrismaClient();

  const uns = await prisma.unidadeEstoque.findMany({
    where: { codigo: { in: codigos } },
    select: { id: true, codigo: true, status: true, descricao: true, cor: true, tamanho: true, pedidoId: true, expedicaoId: true },
  });
  const naoAchados = codigos.filter((c) => !uns.some((u) => u.codigo === c));
  if (naoAchados.length) console.log(`não encontradas (${naoAchados.length}): ${naoAchados.join(', ')}`);

  // Expedição ABERTA segurando a peça: dar baixa some com ela do romaneio.
  const expIds = [...new Set(uns.map((u) => u.expedicaoId).filter(Boolean))];
  const abertas = expIds.length
    ? await prisma.expedicao.findMany({ where: { id: { in: expIds }, status: { notIn: ['Despachado', 'Cancelada'] } }, select: { id: true, numero: true } })
    : [];
  const presas = uns.filter((u) => u.expedicaoId != null && abertas.some((e) => e.id === u.expedicaoId));
  if (presas.length) {
    console.error(`\nRECUSADO: ${presas.length} etiqueta(s) em expedição ABERTA (${abertas.map((e) => e.numero).join(', ')}).`);
    console.error('Conclua ou estorne a expedição antes.');
    process.exit(1);
  }

  const baixar = uns.filter((u) => u.status !== 'despachado');
  const jaFora = uns.length - baixar.length;
  const porStatus = {};
  baixar.forEach((u) => { porStatus[u.status] = (porStatus[u.status] ?? 0) + 1; });

  console.log(`\n${baixar.length} etiqueta(s) a baixar${jaFora ? ` · ${jaFora} já estavam despachadas` : ''}`);
  Object.entries(porStatus).forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}  ${s}`));
  console.log(`motivo: ${MOTIVO}`);

  if (!baixar.length) { console.log('\nNada a fazer.'); await prisma.$disconnect(); return; }
  if (!APLICAR) { console.log('\n(modo conferência — rode com --aplicar para valer)'); await prisma.$disconnect(); return; }

  // Uma escrita só (o Neon derruba transação longa), e pelos IDs lidos acima.
  const r = await prisma.unidadeEstoque.updateMany({
    where: { id: { in: baixar.map((u) => u.id) } },
    data: { status: 'despachado', saidaEm: new Date() },
  });

  const soltas = baixar.filter((u) => u.status === 'reservado');
  let detalheReserva = '';
  if (soltas.length) {
    const pedIds = [...new Set(soltas.map((u) => u.pedidoId).filter(Boolean))];
    const peds = pedIds.length ? await prisma.pedido.findMany({ where: { id: { in: pedIds } }, select: { numero: true } }) : [];
    detalheReserva = ` · ${soltas.length} estavam RESERVADAS${peds.length ? ' (' + peds.map((p) => p.numero).join(', ') + ')' : ''}`;
  }
  await prisma.log.create({
    data: {
      usuario: USUARIO, acao: 'estoque.saida.lote',
      detalhe: `${r.count} etiqueta(s) baixadas · ${MOTIVO}${detalheReserva} · ${baixar.slice(0, 5).map((u) => u.codigo).join(', ')}${baixar.length > 5 ? '…' : ''}`,
      entidade: 'UnidadeEstoque',
    },
  }).catch(() => undefined);

  console.log(`\nbaixadas: ${r.count}${detalheReserva}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
