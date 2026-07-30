import PDFDocument from 'pdfkit';

/**
 * Renderização dos documentos em papel timbrado (identidade preto & dourado).
 * Fontes: Helvetica embutida no PDF (evita distribuir arquivos de fonte);
 * a identidade é preservada por cores, hierarquia e composição.
 */

const OURO = '#C9A227';
const OURO_ESCURO = '#9a7d1e';
const NAVY = '#1E2C48';
const ONIX = '#0A0A0A';
const MARFIM = '#F4F2ED';
const TINTA = '#242a26';
const CINZA = '#807d72';
const LINHA = '#e6e4dc';

export type Pdf = InstanceType<typeof PDFDocument>;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v: unknown) => BRL.format(Number(v ?? 0));
export const dataBR = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

/** Cria o documento A4 com papel timbrado (cabeçalho + rodapé em toda página). */
export function novoDocumento(titulo: string, numero: string): Pdf {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 128, bottom: 70, left: 50, right: 50 } });
  const timbre = () => cabecalho(doc, titulo, numero);
  timbre();
  doc.on('pageAdded', timbre);
  return doc;
}

function cabecalho(doc: Pdf, titulo: string, numero: string): void {
  const w = doc.page.width;
  // Faixa ônix
  doc.save();
  doc.rect(0, 0, w, 92).fill(ONIX);
  doc.rect(0, 92, w, 3).fill(OURO);
  // Marca
  doc.fillColor(OURO).font('Helvetica-Bold').fontSize(7).text('G R U P O', 50, 26, { characterSpacing: 2 });
  doc.fillColor(MARFIM).font('Helvetica-Bold').fontSize(21).text('CHERKESIAN', 50, 36);
  doc.fillColor(CINZA).font('Helvetica').fontSize(6.5).text('U N I F O R M E S   P R O F I S S I O N A I S', 50, 62, { characterSpacing: 1 });
  // Título + número à direita
  doc.fillColor(MARFIM).font('Helvetica-Bold').fontSize(13).text(titulo.toUpperCase(), w - 300, 30, { width: 250, align: 'right' });
  doc.fillColor(OURO).font('Helvetica-Bold').fontSize(10).text(numero, w - 300, 50, { width: 250, align: 'right' });
  doc
    .fillColor(CINZA)
    .font('Helvetica')
    .fontSize(8)
    .text(`Emitido em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, w - 300, 64, { width: 250, align: 'right' });
  // Rodapé — zera a margem inferior enquanto escreve, senão o text() abaixo de
  // maxY dispara a auto-paginação do pdfkit (addPage em cascata).
  const margemInferior = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const hFoot = doc.page.height - 52;
  doc.moveTo(50, hFoot).lineTo(w - 50, hFoot).lineWidth(0.7).strokeColor(LINHA).stroke();
  doc
    .fillColor(CINZA)
    .fontSize(7.5)
    .text('GRUPO CHERKESIAN · Uniformes Profissionais — "Vestindo quem faz acontecer"', 50, hFoot + 8, { width: w - 100, align: 'center' })
    .text('Documento gerado eletronicamente pelo Cherkesian ERP', 50, hFoot + 19, { width: w - 100, align: 'center' });
  doc.page.margins.bottom = margemInferior;
  doc.restore();
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
  // Reposiciona o cursor no início do corpo (text('') vazio NÃO move o cursor no pdfkit).
  doc.x = 50;
  doc.y = 118;
}

/** Título de seção dourado. */
export function secao(doc: Pdf, titulo: string): void {
  doc.moveDown(0.8);
  doc.fillColor(OURO_ESCURO).font('Helvetica-Bold').fontSize(9).text(titulo.toUpperCase(), { characterSpacing: 0.8 });
  const y = doc.y + 3;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(0.7).strokeColor(LINHA).stroke();
  doc.moveDown(0.5);
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Par rótulo/valor em linha (rótulo em cima, valor embaixo — largura total). */
export function campo(doc: Pdf, rotulo: string, valor: string): void {
  const x = 50;
  const w = doc.page.width - 100;
  doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text(rotulo.toUpperCase(), x, doc.y, { width: w });
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(valor || '—', x, doc.y + 1, { width: w });
  doc.x = x;
  doc.moveDown(0.35);
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/**
 * Grade de campos em 2 colunas. Cada coluna tem largura FIXA e o texto quebra
 * dentro dela; a linha avança pela altura do maior dos dois campos — assim
 * rótulo e valor (ou as duas colunas) NUNCA se sobrepõem, seja qual for o tamanho.
 */
export function camposDuplos(doc: Pdf, pares: Array<[string, string]>): void {
  const xEsq = 50;
  const gap = 22;
  const colW = (doc.page.width - 100 - gap) / 2;
  const xDir = xEsq + colW + gap;
  const desenhar = (rotulo: string, valor: string, x: number, y: number): number => {
    doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text((rotulo || '').toUpperCase(), x, y, { width: colW });
    const yValor = doc.y + 1;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(valor || '—', x, yValor, { width: colW });
    return doc.y; // fundo do campo
  };
  for (let i = 0; i < pares.length; i += 2) {
    const y0 = doc.y;
    const yEsq = desenhar(pares[i][0], pares[i][1], xEsq, y0);
    const yDir = pares[i + 1] ? desenhar(pares[i + 1][0], pares[i + 1][1], xDir, y0) : y0;
    doc.x = xEsq;
    doc.y = Math.max(yEsq, yDir) + 8;
  }
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Tabela simples com cabeçalho dourado. */
export function tabela(
  doc: Pdf,
  colunas: Array<{ titulo: string; largura: number; alinhamento?: 'left' | 'right' }>,
  linhas: string[][],
): void {
  const x0 = 50;
  let y = doc.y + 4;
  // Cabeçalho
  doc.rect(x0, y, doc.page.width - 100, 20).fill('#faf6ea');
  let x = x0 + 8;
  doc.fillColor(OURO_ESCURO).font('Helvetica-Bold').fontSize(8);
  for (const col of colunas) {
    doc.text(col.titulo.toUpperCase(), x, y + 6, { width: col.largura - 10, align: col.alinhamento ?? 'left' });
    x += col.largura;
  }
  y += 20;
  // Linhas
  doc.font('Helvetica').fontSize(9.5);
  for (const linha of linhas) {
    if (y > doc.page.height - 110) { doc.addPage(); y = 128; }
    x = x0 + 8;
    let alturaMax = 14;
    linha.forEach((cel, i) => {
      const h = doc.heightOfString(cel, { width: colunas[i].largura - 10 });
      alturaMax = Math.max(alturaMax, h + 4);
    });
    linha.forEach((cel, i) => {
      doc.fillColor(TINTA).text(cel, x, y + 4, { width: colunas[i].largura - 10, align: colunas[i].alinhamento ?? 'left' });
      x += colunas[i].largura;
    });
    y += alturaMax + 4;
    doc.moveTo(x0, y).lineTo(doc.page.width - 50, y).lineWidth(0.5).strokeColor(LINHA).stroke();
  }
  doc.x = x0;
  doc.y = y + 8;
}

/**
 * Grade de tamanhos em caixinhas (visualização de operação na OP).
 * Cada caixa: tamanho no topo (faixa dourada) e quantidade grande abaixo;
 * quantidade vazia ('') desenha a caixa em branco para preenchimento manual.
 */
export function gradeCaixinhas(doc: Pdf, itens: Array<[string, string]>): void {
  const larguraCaixa = 62;
  const alturaCaixa = 52;
  const gap = 8;
  const x0 = 50;
  const maxX = doc.page.width - 50;
  let x = x0;
  let y = doc.y + 6;

  for (const [tamanho, qtd] of itens) {
    if (x + larguraCaixa > maxX) { x = x0; y += alturaCaixa + gap; }
    if (y + alturaCaixa > doc.page.height - 110) { doc.addPage(); y = 128; x = x0; }
    // moldura
    doc.roundedRect(x, y, larguraCaixa, alturaCaixa, 5).lineWidth(0.9).strokeColor(OURO).stroke();
    // faixa do tamanho
    doc.roundedRect(x, y, larguraCaixa, 17, 5).fill('#f7efd3');
    doc.rect(x, y + 9, larguraCaixa, 8).fill('#f7efd3'); // esconde cantos inferiores da faixa
    doc.fillColor(OURO_ESCURO).font('Helvetica-Bold').fontSize(9)
      .text(tamanho, x, y + 5, { width: larguraCaixa, align: 'center' });
    // quantidade
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(17)
      .text(qtd || ' ', x, y + 25, { width: larguraCaixa, align: 'center' });
    x += larguraCaixa + gap;
  }
  doc.x = x0;
  doc.y = y + alturaCaixa + 12;
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/**
 * Grade de tamanhos em TABELA: linha de cabeçalho com os tamanhos + coluna Total,
 * e uma linha com as quantidades (em branco quando não informadas).
 */
export function gradeTabela(doc: Pdf, itens: Array<[string, string]>): void {
  const x0 = 50;
  const tableW = doc.page.width - 100;
  const cols = itens.length + 1; // + coluna Total
  const colW = tableW / cols;
  const rowH = 26;
  let y = doc.y + 4;
  if (y + rowH * 2 > doc.page.height - 110) { doc.addPage(); y = 128; }

  const total = itens.reduce((s, [, q]) => s + (Number(q) || 0), 0);
  const headers = [...itens.map(([t]) => t), 'Total'];
  const values = [...itens.map(([, q]) => q || ''), total ? String(total) : ''];

  // Cabeçalho (faixa dourada clara)
  for (let i = 0; i < cols; i++) {
    const x = x0 + i * colW;
    doc.rect(x, y, colW, rowH).fill('#f7efd3');
    doc.rect(x, y, colW, rowH).lineWidth(0.8).strokeColor(OURO).stroke();
    doc.fillColor(OURO_ESCURO).font('Helvetica-Bold').fontSize(10)
      .text(headers[i], x, y + rowH / 2 - 6, { width: colW, align: 'center' });
  }
  // Linha de quantidades
  const y2 = y + rowH;
  for (let i = 0; i < cols; i++) {
    const x = x0 + i * colW;
    doc.rect(x, y2, colW, rowH).fillColor('#ffffff').fill();
    doc.rect(x, y2, colW, rowH).lineWidth(0.8).strokeColor(OURO).stroke();
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(13)
      .text(values[i] || ' ', x, y2 + rowH / 2 - 8, { width: colW, align: 'center' });
  }
  doc.x = x0;
  doc.y = y2 + rowH + 12;
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Parágrafo de texto (preserva quebras de linha). */
export function textoBloco(doc: Pdf, texto: string): void {
  doc.fillColor(TINTA).font('Helvetica').fontSize(9.5).text(texto || '—', 50, doc.y, {
    width: doc.page.width - 100,
    align: 'left',
    lineGap: 1.5,
  });
  doc.x = 50;
  doc.moveDown(0.3);
}

/**
 * Insere uma imagem a partir de um data URI base64 (foto do modelo/modelagem).
 * Tolerante a erros: imagem inválida apenas registra um aviso e não quebra o PDF.
 */
export function imagem(doc: Pdf, dataUri: string | null | undefined, alturaMax = 210): void {
  if (!dataUri) return;
  const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/s.exec(dataUri.trim());
  if (!m) return;
  try {
    const buf = Buffer.from(m[1], 'base64');
    const largura = doc.page.width - 100;
    if (doc.y + alturaMax > doc.page.height - 90) { doc.addPage(); }
    doc.image(buf, 50, doc.y + 2, { fit: [largura, alturaMax], align: 'center' });
    doc.y = doc.y + alturaMax + 8;
    doc.x = 50;
  } catch {
    doc.fillColor(CINZA).font('Helvetica-Oblique').fontSize(8.5).text('(imagem não pôde ser exibida)', 50, doc.y);
    doc.moveDown(0.4);
  }
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/**
 * Tabela de medidas (grade): coluna "Medida" + "Tol." + uma coluna por tamanho.
 * Larguras calculadas dinamicamente para caber na página, com fonte compacta.
 */
export function tabelaMedidas(doc: Pdf, tamanhos: string[], linhas: Array<{ descricao: string; tolerancia: string; valores: string[] }>): void {
  const x0 = 50;
  const larguraUtil = doc.page.width - 100;
  const wDesc = Math.min(150, Math.max(90, larguraUtil - 40 - tamanhos.length * 34));
  const wTol = 38;
  const wTam = tamanhos.length ? Math.max(20, (larguraUtil - wDesc - wTol) / tamanhos.length) : 0;
  const fonte = wTam < 26 ? 7 : 8;

  const desenharCabecalho = (y: number): number => {
    doc.rect(x0, y, larguraUtil, 18).fill('#faf6ea');
    doc.fillColor(OURO_ESCURO).font('Helvetica-Bold').fontSize(fonte);
    doc.text('MEDIDA', x0 + 6, y + 6, { width: wDesc - 8 });
    doc.text('TOL.', x0 + wDesc, y + 6, { width: wTol - 4, align: 'center' });
    let x = x0 + wDesc + wTol;
    for (const t of tamanhos) {
      doc.text(t, x, y + 6, { width: wTam, align: 'center' });
      x += wTam;
    }
    return y + 18;
  };

  let y = desenharCabecalho(doc.y + 4);
  doc.font('Helvetica').fontSize(fonte);
  for (const l of linhas) {
    if (y > doc.page.height - 100) { doc.addPage(); y = desenharCabecalho(128); doc.font('Helvetica').fontSize(fonte); }
    const h = 15;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(fonte).text(l.descricao, x0 + 6, y + 4, { width: wDesc - 8, ellipsis: true, height: h });
    doc.font('Helvetica').fillColor(CINZA).text(l.tolerancia || '', x0 + wDesc, y + 4, { width: wTol - 4, align: 'center' });
    let x = x0 + wDesc + wTol;
    doc.fillColor(TINTA);
    for (let i = 0; i < tamanhos.length; i++) {
      doc.text(l.valores[i] ?? '', x, y + 4, { width: wTam, align: 'center' });
      x += wTam;
    }
    y += h;
    doc.moveTo(x0, y).lineTo(x0 + larguraUtil, y).lineWidth(0.4).strokeColor(LINHA).stroke();
  }
  // molduras verticais das colunas de tamanho (leitura em coluna)
  doc.x = x0;
  doc.y = y + 8;
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Destaque de total (caixa dourada à direita). */
export function totalDestaque(doc: Pdf, rotulo: string, valor: string): void {
  const w = 220;
  const x = doc.page.width - 50 - w;
  const y = doc.y + 6;
  doc.rect(x, y, w, 40).fill(ONIX);
  doc.fillColor(OURO).font('Helvetica').fontSize(8).text(rotulo.toUpperCase(), x + 14, y + 8);
  doc.fillColor(MARFIM).font('Helvetica-Bold').fontSize(15).text(valor, x + 14, y + 19);
  doc.x = 50;
  doc.y = y + 52;
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Bloco de assinaturas lado a lado. */
export function assinaturas(doc: Pdf, esquerda: string, direita: string): void {
  // Se não há espaço abaixo do conteúdo atual, quebra página (evita sobrepor a tabela).
  if (doc.y + 60 > doc.page.height - 80) doc.addPage();
  const y = doc.y + 46;
  const w = (doc.page.width - 100 - 40) / 2;
  doc.moveTo(50, y).lineTo(50 + w, y).lineWidth(0.8).strokeColor(TINTA).stroke();
  doc.moveTo(50 + w + 40, y).lineTo(50 + w + 40 + w, y).lineWidth(0.8).strokeColor(TINTA).stroke();
  doc.fillColor(CINZA).fontSize(8.5);
  doc.text(esquerda, 50, y + 5, { width: w, align: 'center' });
  doc.text(direita, 50 + w + 40, y + 5, { width: w, align: 'center' });
}

/** Chips da grade de tamanhos (só os com peça + TOTAL em navy/dourado). Estilo minimalista. */
export function gradeChips(doc: Pdf, grade: Record<string, number> | null | undefined): void {
  const ent = Object.entries(grade ?? {}).filter(([, q]) => Number(q) > 0);
  if (!ent.length) return;
  const total = ent.reduce((s, [, q]) => s + Number(q), 0);
  const chips = ent.map(([t, q]) => ({ txt: `${t}  ${q}`, tot: false }));
  chips.push({ txt: `TOTAL  ${total}`, tot: true });
  const h = 17, gap = 5, padX = 9;
  const x0 = 50, maxX = doc.page.width - 50;
  let x = x0, y = doc.y + 2;
  for (const c of chips) {
    doc.font('Helvetica-Bold').fontSize(8.5);
    const cw = doc.widthOfString(c.txt) + padX * 2;
    if (x + cw > maxX) { x = x0; y += h + gap; }
    if (c.tot) {
      doc.roundedRect(x, y, cw, h, 4).fill(NAVY);
      doc.fillColor(OURO).text(c.txt, x, y + 4.5, { width: cw, align: 'center' });
    } else {
      doc.roundedRect(x, y, cw, h, 4).lineWidth(0.8).strokeColor('#DED9CB').stroke();
      doc.fillColor(TINTA).text(c.txt, x, y + 4.5, { width: cw, align: 'center' });
    }
    x += cw + gap;
  }
  doc.x = x0;
  doc.y = y + h + 8;
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Um item do pedido no estilo minimalista: nº + descrição, valor à direita e chips da grade. */
/**
 * Tabela densa de itens no estilo "pedido 479": uma linha por item (quebrada em 2
 * quando há faixa de preço especial), tamanhos em colunas + V.Unit e V.Total,
 * e linha de totais. Ocupa pouquíssimo espaço — pedido grande cabe em 1 página.
 */
export function pedidoGradeTabela(
  doc: Pdf,
  data: {
    sizes: string[];
    rows: Array<{ num: string; descricao: string; cor?: string | null; qtyBySize: Record<string, number>; vUnit: string; vTotal: string }>;
    totBySize: Record<string, number>;
    totPecas: number;
    totValor: string;
  },
): void {
  const x0 = 50;
  const tableW = doc.page.width - 100;
  const cItem = 20, cCor = 58, cVU = 46, cVT = 60;
  const nS = data.sizes.length;
  const cSize = Math.max(16, Math.min(30, Math.floor((tableW * 0.36) / Math.max(1, nS))));
  const cDesc = tableW - cItem - cCor - cVU - cVT - cSize * nS;
  const cols: Array<{ w: number; a: 'left' | 'center' | 'right' }> = [
    { w: cItem, a: 'center' }, { w: cDesc, a: 'left' }, { w: cCor, a: 'left' },
    ...data.sizes.map(() => ({ w: cSize, a: 'center' as const })),
    { w: cVU, a: 'right' }, { w: cVT, a: 'right' },
  ];
  const headers = ['#', 'DESCRIÇÃO', 'COR', ...data.sizes, 'V.UN', 'V.TOTAL'];

  const drawRow = (cells: string[], o: { header?: boolean; total?: boolean } = {}) => {
    const fs = o.header ? 6.8 : 7.4;
    doc.font(o.header || o.total ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    // altura pela coluna mais alta (descrição OU cor, que também quebra linha)
    const hDesc = doc.heightOfString(cells[1] || '', { width: cols[1].w - 6 });
    const hCor = doc.heightOfString(cells[2] || '', { width: cols[2].w - 6 });
    const rowH = Math.max(o.header ? 16 : 15, Math.max(hDesc, hCor) + 6);
    if (doc.y + rowH > doc.page.height - 80) { doc.addPage(); }
    let x = x0; const y = doc.y;
    for (let i = 0; i < cols.length; i++) {
      if (o.header) doc.rect(x, y, cols[i].w, rowH).fill('#f4f0e2');
      else if (o.total) doc.rect(x, y, cols[i].w, rowH).fill('#faf6ea');
      doc.rect(x, y, cols[i].w, rowH).lineWidth(0.4).strokeColor('#c9bd93').stroke();
      doc.fillColor(o.header ? OURO_ESCURO : TINTA).font(o.header || o.total ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs)
        .text(cells[i] ?? '', x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].a, lineBreak: true });
      x += cols[i].w;
    }
    doc.x = x0; doc.y = y + rowH;
  };

  drawRow(headers, { header: true });
  for (const r of data.rows) {
    drawRow([r.num, r.descricao, r.cor ?? '—', ...data.sizes.map((s) => (r.qtyBySize[s] ? String(r.qtyBySize[s]) : '')), r.vUnit, r.vTotal]);
  }
  drawRow(['', 'TOTAL', '', ...data.sizes.map((s) => (data.totBySize[s] ? String(data.totBySize[s]) : '0')), String(data.totPecas), data.totValor], { total: true });
  doc.x = x0; doc.moveDown(0.6);
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Foto do produto num quadrado padrão (canto do item). Sem foto, desenha moldura "FOTO". */
function drawFotoCanto(doc: Pdf, dataUri: string | null | undefined, x: number, y: number, size: number): void {
  const m = dataUri ? /^data:image\/[a-zA-Z+]+;base64,(.+)$/s.exec(dataUri.trim()) : null;
  if (m) {
    try {
      doc.image(Buffer.from(m[1], 'base64'), x, y, { fit: [size, size], align: 'center', valign: 'center' });
      doc.rect(x, y, size, size).lineWidth(0.8).strokeColor(OURO).stroke();
      return;
    } catch {
      /* imagem inválida: cai na moldura abaixo */
    }
  }
  doc.roundedRect(x, y, size, size, 5).lineWidth(0.8).dash(3, { space: 3 }).strokeColor(OURO).stroke().undash();
  doc.fillColor('#a99a63').font('Helvetica').fontSize(8).text('FOTO', x, y + size / 2 - 5, { width: size, align: 'center' });
  doc.fillColor(TINTA);
}

export function itemPedido(
  doc: Pdf,
  o: {
    num: string;
    descricao: string;
    cor?: string | null;
    foto?: string | null;
    linhas: Array<{ tam: string; qtd: number; unit: string; total: string }>;
    subtotal: string;
  },
): void {
  const linhas = o.linhas ?? [];
  const FOTO = 84; // caixa quadrada padrão da foto no canto
  const alturaEstim = Math.max(FOTO + 8, 34 + (linhas.length + 2) * 20) + 30;
  if (doc.y + alturaEstim > doc.page.height - 90) doc.addPage();
  const x0 = 50;
  const yTop = doc.y;
  // Foto do produto no canto superior direito (formato padrão) — ou moldura em branco.
  const xFoto = doc.page.width - 50 - FOTO;
  drawFotoCanto(doc, o.foto, xFoto, yTop, FOTO);
  // nº + descrição (larguras limitadas para não invadir a foto)
  const wTexto = xFoto - (x0 + 30) - 10;
  doc.roundedRect(x0, yTop, 22, 15, 3).fill(NAVY);
  doc.fillColor(MARFIM).font('Helvetica-Bold').fontSize(8).text(o.num, x0, yTop + 4, { width: 22, align: 'center' });
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11.5).text(o.descricao, x0 + 30, yTop + 1, { width: wTexto });
  if (o.cor) {
    doc.fillColor(CINZA).font('Helvetica').fontSize(9.5).text('Cor: ' + o.cor, x0 + 30, doc.y + 1, { width: wTexto });
  }
  doc.x = x0;
  // A tabela ocupa a largura total; começa abaixo da foto para não sobrepô-la.
  doc.y = Math.max(doc.y + 4, yTop + FOTO + 8);

  // Tabela: Tamanho | Qtd | Valor unit. | Total
  const tableW = doc.page.width - 100;
  const cQtd = 70, cUnit = 120, cTotal = 130;
  const cTam = tableW - cQtd - cUnit - cTotal;
  const rowH = 20;
  const drawRow = (cells: string[], opts: { header?: boolean; bold?: boolean } = {}) => {
    let y = doc.y;
    if (y + rowH > doc.page.height - 80) { doc.addPage(); y = doc.y; }
    const ws = [cTam, cQtd, cUnit, cTotal];
    const aligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right', 'right'];
    let x = x0;
    for (let i = 0; i < cells.length; i++) {
      if (opts.header) doc.rect(x, y, ws[i], rowH).fill('#f7efd3');
      doc.rect(x, y, ws[i], rowH).lineWidth(0.6).strokeColor(OURO).stroke();
      doc.fillColor(opts.header ? OURO_ESCURO : TINTA)
        .font(opts.header || opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.header ? 9 : 10)
        .text(cells[i], x + 4, y + rowH / 2 - 6, { width: ws[i] - 8, align: aligns[i] });
      x += ws[i];
    }
    doc.x = x0; doc.y = y + rowH;
  };
  drawRow(['Tamanho', 'Qtd', 'Valor unit.', 'Total'], { header: true });
  linhas.forEach((l) => drawRow([l.tam, String(l.qtd), l.unit, l.total]));
  // Linha de subtotal do item
  const totQtd = linhas.reduce((s, l) => s + (Number(l.qtd) || 0), 0);
  drawRow(['Subtotal do item', String(totQtd), '', o.subtotal], { bold: true });

  doc.moveDown(0.6);
  doc.moveTo(x0, doc.y).lineTo(doc.page.width - 50, doc.y).lineWidth(0.5).strokeColor(LINHA).stroke();
  doc.moveDown(0.5);
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Rodapé com as empresas do Grupo Cherkesian (faixa fina). */
export function rodapeGrupo(doc: Pdf): void {
  if (doc.y > doc.page.height - 120) doc.addPage();
  const y = doc.y + 8;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(0.9).strokeColor(TINTA).stroke();
  doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(7.5)
    .text('UMA EMPRESA DO GRUPO CHERKESIAN', 50, y + 7, { width: doc.page.width - 100, align: 'center', characterSpacing: 1 });
  doc.fillColor(OURO_ESCURO).font('Helvetica-Bold').fontSize(8.5)
    .text('YEREVAN CONFECÇÕES     ·     HC QUALITY CORPORATE     ·     SANITEX     ·     HTM CONCEPT', 50, y + 18, { width: doc.page.width - 100, align: 'center' });
  doc.x = 50;
  doc.y = y + 34;
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
}

/** Etiqueta compacta (A6 paisagem) — usada para identificar lote/volume. */
export function novaEtiqueta(): Pdf {
  const doc = new PDFDocument({ size: [420, 298], margins: { top: 18, bottom: 18, left: 20, right: 20 } });
  doc.rect(0, 0, 420, 54).fill(ONIX);
  doc.rect(0, 54, 420, 3).fill(OURO);
  doc.fillColor(OURO).font('Helvetica-Bold').fontSize(6).text('G R U P O', 20, 14, { characterSpacing: 2 });
  doc.fillColor(MARFIM).font('Helvetica-Bold').fontSize(15).text('CHERKESIAN', 20, 22);
  doc.fillColor(TINTA).font('Helvetica').fontSize(10);
  doc.x = 20;
  doc.y = 72;
  return doc;
}
