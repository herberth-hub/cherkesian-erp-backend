/**
 * Converte o texto `Produto.cor` ("AZUL ROYAL, BRANCO") em linhas de ProdutoCor,
 * e usa a foto do modelo como mockup de frente da PRIMEIRA cor.
 *
 * Só INSERE. Não apaga nem reescreve nada: `Produto.cor` fica como está, e
 * produto que já tenha cor cadastrada é pulado. Rodar de novo não duplica.
 *
 *   node scripts/migrar-cores-produto.js            # só mostra o que faria
 *   node scripts/migrar-cores-produto.js --aplicar  # grava
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const EMPRESA = Number(process.env.EMPRESA_ID || 1);
/**
 * Produtos cujo texto de cor NÃO é uma lista de cores — viram uma cor só, com o
 * texto inteiro. Passe outros com --unica=PRD-X,PRD-Y.
 *  - PRD-BOR-0001 é serviço de bordado: ali estão as POSIÇÕES (peito, manga…).
 *  - PRD-ACE-0001 é uma faixa preta com impressão branca, peça única bicolor.
 */
const UNICA = new Set(
  ['PRD-BOR-0001', 'PRD-ACE-0001']
    .concat(
      (process.argv.find((a) => a.startsWith('--unica=')) ?? '')
        .replace('--unica=', '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
);

// Separa SÓ em vírgula e ponto-e-vírgula. A barra não entra: "BRANCO C/ VERDE"
// é uma cor só (peça branca com detalhe verde), e cortar ali inventava duas.
function separarCores(texto) {
  return String(texto ?? '')
    .split(/\s*[,;]\s*/)
    .map((s) => s.trim().replace(/\s+/g, ' ').toUpperCase())
    .filter(Boolean);
}

(async () => {
  const prisma = new PrismaClient();
  const produtos = await prisma.produto.findMany({
    where: { empresaId: EMPRESA },
    select: { id: true, codigo: true, cor: true, fotoModelo: true },
    orderBy: { codigo: 'asc' },
  });
  const jaTem = new Set(
    (await prisma.produtoCor.findMany({ select: { produtoId: true } })).map((c) => c.produtoId),
  );

  const novas = [];
  const comFoto = [];
  const multiplas = [];
  let semCor = 0;
  let pulados = 0;

  for (const p of produtos) {
    if (jaTem.has(p.id)) { pulados++; continue; }
    const cores = UNICA.has(p.codigo)
      ? [String(p.cor ?? '').trim().replace(/\s+/g, ' ').toUpperCase()].filter(Boolean)
      : separarCores(p.cor);
    if (!cores.length) { semCor++; continue; }
    if (cores.length > 1) multiplas.push(`${p.codigo}: ${cores.join(' | ')}`);
    cores.forEach((nome, i) => {
      novas.push({ produtoId: p.id, nome, ordem: i });
      // A foto do modelo é uma só; vira o mockup da primeira cor. As outras
      // nascem sem imagem, para serem enviadas na ficha técnica.
      if (i === 0 && String(p.fotoModelo ?? '').startsWith('data:image')) {
        comFoto.push({ produtoId: p.id, nome, foto: p.fotoModelo });
      }
    });
  }

  console.log(`produtos da empresa ${EMPRESA}: ${produtos.length}`);
  console.log(`  já com cores cadastradas (pulados): ${pulados}`);
  console.log(`  sem nenhuma cor no texto: ${semCor}`);
  console.log(`  linhas de cor a criar: ${novas.length}`);
  console.log(`  dessas, com mockup de frente vindo da foto do modelo: ${comFoto.length}`);
  console.log('');
  console.log(`CONFERIR — ${multiplas.length} produto(s) cujo texto virou MAIS DE UMA cor.`);
  console.log('Se algum deles for uma peça bicolor (ex.: "PRETO, BRANCA" numa peça só),');
  console.log('junte as duas na ficha técnica depois — aqui elas viram duas cores.');
  for (const m of multiplas) console.log('   ' + m);

  if (!APLICAR) {
    console.log('\n(nada foi gravado — rode com --aplicar para valer)');
    await prisma.$disconnect();
    return;
  }

  // Poucas idas ao banco: um createMany e um update por foto (o Neon derruba
  // transação longa, então nada de laço dentro de $transaction).
  const r = await prisma.produtoCor.createMany({ data: novas, skipDuplicates: true });
  console.log(`\ncriadas: ${r.count} linha(s) de cor`);

  let fotos = 0;
  for (const f of comFoto) {
    const cor = await prisma.produtoCor.findFirst({
      where: { produtoId: f.produtoId, nome: f.nome },
      select: { id: true, mockupFrente: true },
    });
    if (!cor || cor.mockupFrente) continue;
    await prisma.produtoCor.update({ where: { id: cor.id }, data: { mockupFrente: f.foto } });
    fotos++;
  }
  console.log(`mockups de frente preenchidos a partir da foto do modelo: ${fotos}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); process.exit(1); });
