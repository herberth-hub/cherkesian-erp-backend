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
