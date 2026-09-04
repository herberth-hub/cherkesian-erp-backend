import PDFDocument from 'pdfkit';

/** Dados para a PRÉVIA da NF-e (sem valor fiscal). */
export interface PreviaNfeData {
  numero: string;
  serie: string;
  cfop?: string | null;
  natureza?: string | null;
  emitidaEm?: Date | string | null;
  tipo?: string | null;
  status?: string | null;
  emitente: { nome: string; cnpj?: string | null; ie?: string | null; endereco?: string | null };
  destinatario: { nome: string; cnpj?: string | null; ie?: string | null; endereco?: string | null };
  itens: Array<{ codigo?: string | null; descricao: string; ncm?: string | null; cfop?: string | null; unidade?: string | null; qtd: number; vUnit: number; vTotal: number }>;
  totais: { produtos: number; frete?: number; total: number; baseIcms?: number | null; valorIcms?: number | null };
  infoAdic?: string | null;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v: unknown) => BRL.format(Number(v ?? 0));
const dataBR = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

/** Marca d'água diagonal "NF SEM VALOR FISCAL" (repetida em cada página). */
function marcaDagua(doc: InstanceType<typeof PDFDocument>): void {
  doc.save();
  doc.rotate(-30, { origin: [297, 400] });
  doc.fillColor('#d98f80').opacity(0.18).fontSize(42).font('Helvetica-Bold');
  for (let y = 120; y < 760; y += 150) {
    doc.text('NF SEM VALOR FISCAL', -60, y, { width: 720, align: 'center' });
  }
  doc.opacity(1).restore();
  doc.font('Helvetica').fillColor('#000');
}

export function renderPreviaNfe(d: PreviaNfeData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 34 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.on('pageAdded', () => marcaDagua(doc));

    const L = 34, R = 561, W = R - L;
    marcaDagua(doc);

    // Faixa de aviso
    doc.rect(L, 34, W, 22).fill('#fdecea');
    doc.fillColor('#b03a2e').font('Helvetica-Bold').fontSize(11)
      .text('PRÉVIA — DOCUMENTO SEM VALOR FISCAL (apenas conferência antes de autorizar)', L, 40, { width: W, align: 'center' });
    doc.fillColor('#000');

    // Título
    doc.font('Helvetica-Bold').fontSize(13).text(`DANFE (prévia) · NF-e nº ${d.numero}  ·  Série ${d.serie}`, L, 64);
    doc.font('Helvetica').fontSize(8.5).fillColor('#555')
      .text([
        d.natureza ? `Natureza: ${d.natureza}` : null,
        d.cfop ? `CFOP: ${d.cfop}` : null,
        d.tipo ? `Tipo: ${d.tipo}` : null,
        `Emitida (prévia): ${dataBR(d.emitidaEm)}`,
        d.status ? `Status atual: ${d.status}` : null,
      ].filter(Boolean).join('   ·   '), L, 82, { width: W });
    doc.fillColor('#000');

    // Emitente / Destinatário
    const boxY = 100, boxH = 62, colW = (W - 8) / 2;
    const parte = (x: number, titulo: string, p: { nome: string; cnpj?: string | null; ie?: string | null; endereco?: string | null }) => {
      doc.rect(x, boxY, colW, boxH).strokeColor('#ccc').lineWidth(0.7).stroke();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#8a6d1e').text(titulo, x + 6, boxY + 5);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000').text(p.nome || '—', x + 6, boxY + 16, { width: colW - 12 });
      doc.font('Helvetica').fontSize(8).fillColor('#333').text([
        p.cnpj ? `CNPJ/CPF: ${p.cnpj}` : null,
        p.ie ? `IE: ${p.ie}` : null,
      ].filter(Boolean).join('   ') || ' ', x + 6, boxY + 33, { width: colW - 12 });
      doc.fontSize(7.5).fillColor('#555').text(p.endereco || ' ', x + 6, boxY + 44, { width: colW - 12 });
      doc.fillColor('#000');
    };
    parte(L, 'EMITENTE', d.emitente);
    parte(L + colW + 8, 'DESTINATÁRIO', d.destinatario);

    // Tabela de itens
    let y = boxY + boxH + 12;
    const cols = [
      { t: 'Cód.', w: 54, a: 'left' as const },
      { t: 'Descrição', w: 210, a: 'left' as const },
      { t: 'NCM', w: 58, a: 'left' as const },
      { t: 'CFOP', w: 38, a: 'left' as const },
      { t: 'Qtd', w: 42, a: 'right' as const },
      { t: 'V.Unit', w: 60, a: 'right' as const },
      { t: 'V.Total', w: 65, a: 'right' as const },
    ];
    const drawHead = () => {
      doc.rect(L, y, W, 16).fill('#f3ecd8');
      doc.fillColor('#5a4a12').font('Helvetica-Bold').fontSize(8);
      let x = L + 4;
      for (const c of cols) { doc.text(c.t, x, y + 5, { width: c.w - 6, align: c.a }); x += c.w; }
      doc.fillColor('#000').font('Helvetica');
      y += 16;
    };
    drawHead();
    doc.fontSize(8);
    for (const it of d.itens) {
      const desc = it.descricao || '';
      const hDesc = doc.heightOfString(desc, { width: cols[1].w - 6 });
      const rowH = Math.max(14, hDesc + 6);
      if (y + rowH > 770) { doc.addPage(); y = 40; drawHead(); doc.fontSize(8); }
      let x = L + 4;
      const cells = [
        it.codigo || '—', desc, it.ncm || '—', it.cfop || d.cfop || '—',
        String(it.qtd), money(it.vUnit), money(it.vTotal),
      ];
      cells.forEach((val, i) => { doc.fillColor('#222').text(val, x, y + 3, { width: cols[i].w - 6, align: cols[i].a }); x += cols[i].w; });
      doc.moveTo(L, y + rowH).lineTo(R, y + rowH).strokeColor('#eee').lineWidth(0.5).stroke();
      y += rowH;
    }

    // Totais
    y += 10;
    if (y > 700) { doc.addPage(); y = 40; }
    const linhaTot = (rot: string, val: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fillColor('#333')
        .text(rot, R - 260, y, { width: 150, align: 'right' });
      doc.fillColor('#000').text(val, R - 105, y, { width: 105, align: 'right' });
      y += bold ? 16 : 13;
    };
    linhaTot('Valor dos produtos', money(d.totais.produtos));
    if (d.totais.frete) linhaTot('Frete', money(d.totais.frete));
    if (d.totais.baseIcms != null) linhaTot('Base de cálculo ICMS', money(d.totais.baseIcms));
    if (d.totais.valorIcms != null) linhaTot('Valor do ICMS', money(d.totais.valorIcms));
    linhaTot('VALOR TOTAL DA NOTA', money(d.totais.total), true);

    // Dados adicionais
    if (d.infoAdic) {
      y += 8;
      if (y > 740) { doc.addPage(); y = 40; }
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#8a6d1e').text('INFORMAÇÕES ADICIONAIS', L, y); y += 12;
      doc.font('Helvetica').fontSize(8).fillColor('#333').text(d.infoAdic, L, y, { width: W });
      y = doc.y;
    }

    // Rodapé (flui após o conteúdo — sem forçar novas páginas).
    y += 18;
    if (y > 780) { doc.addPage(); y = 40; }
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#999')
      .text('Prévia gerada pelo ERP para conferência. Os impostos definitivos e a validade fiscal só existem após a autorização da SEFAZ.', L, y, { width: W, align: 'center' });

    doc.end();
  });
}
