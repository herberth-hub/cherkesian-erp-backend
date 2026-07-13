import PDFDocument from 'pdfkit';

/**
 * Renderização dos documentos em papel timbrado (identidade preto & dourado).
 * Fontes: Helvetica embutida no PDF (evita distribuir arquivos de fonte);
 * a identidade é preservada por cores, hierarquia e composição.
 */

const OURO = '#C9A227';
const OURO_ESCURO = '#9a7d1e';
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

/** Par rótulo/valor em linha. */
export function campo(doc: Pdf, rotulo: string, valor: string): void {
  const x = doc.x;
  doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text(rotulo.toUpperCase(), x, doc.y, { continued: false });
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(valor || '—');
  doc.moveDown(0.35);
}

/** Grade de campos em 2 colunas. */
export function camposDuplos(doc: Pdf, pares: Array<[string, string]>): void {
  const xEsq = 50;
  const xDir = doc.page.width / 2 + 10;
  for (let i = 0; i < pares.length; i += 2) {
    const y = doc.y;
    doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text(pares[i][0].toUpperCase(), xEsq, y);
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(pares[i][1] || '—', xEsq, doc.y);
    const yFim1 = doc.y;
    if (pares[i + 1]) {
      doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text(pares[i + 1][0].toUpperCase(), xDir, y);
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(pares[i + 1][1] || '—', xDir, doc.y);
    }
    doc.x = xEsq;
    doc.y = Math.max(yFim1, doc.y) + 7;
  }
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
  const y = Math.min(doc.y + 46, doc.page.height - 130);
  const w = (doc.page.width - 100 - 40) / 2;
  doc.moveTo(50, y).lineTo(50 + w, y).lineWidth(0.8).strokeColor(TINTA).stroke();
  doc.moveTo(50 + w + 40, y).lineTo(50 + w + 40 + w, y).lineWidth(0.8).strokeColor(TINTA).stroke();
  doc.fillColor(CINZA).fontSize(8.5);
  doc.text(esquerda, 50, y + 5, { width: w, align: 'center' });
  doc.text(direita, 50 + w + 40, y + 5, { width: w, align: 'center' });
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
