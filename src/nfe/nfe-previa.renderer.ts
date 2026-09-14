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

/** Marca d'água diagonal "PRÉVIA · SEM VALOR FISCAL" (repetida em cada página). */
function marcaDagua(doc: InstanceType<typeof PDFDocument>): void {
  doc.save();
  doc.rotate(-30, { origin: [297, 400] });
  doc.fillColor('#d98f80').opacity(0.16).fontSize(38).font('Helvetica-Bold');
  for (let y = 110; y < 780; y += 130) {
    doc.text('PRÉVIA · SEM VALOR FISCAL', -80, y, { width: 760, align: 'center' });
  }
  doc.opacity(1).restore();
  doc.font('Helvetica').fillColor('#000');
}

export function renderPreviaNfe(d: PreviaNfeData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 24 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.on('pageAdded', () => marcaDagua(doc));

    const L = 24, R = 571, W = R - L;
    marcaDagua(doc);

    // Helpers de "campo" no estilo DANFE: rótulo pequeno em cima, valor embaixo, com borda.
    const box = (x: number, y: number, w: number, h: number) => { doc.rect(x, y, w, h).lineWidth(0.6).strokeColor('#000').stroke(); };
    const campo = (x: number, y: number, w: number, h: number, rotulo: string, valor: string, opts?: { fs?: number; bold?: boolean; align?: 'left' | 'center' | 'right' }) => {
      box(x, y, w, h);
      doc.font('Helvetica').fontSize(5.5).fillColor('#555').text((rotulo || '').toUpperCase(), x + 3, y + 2.5, { width: w - 6, lineBreak: false });
      doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts?.fs ?? 8).fillColor('#000')
        .text(valor || '', x + 3, y + 9.5, { width: w - 6, align: opts?.align ?? 'left', lineBreak: false });
    };
    const faixa = (x: number, y: number, w: number, txt: string) => {
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#000').text(txt.toUpperCase(), x, y, { width: w, align: 'center' });
    };
    const tipoNum = /entrada/i.test(String(d.tipo || '')) ? '0' : '1'; // NFs de saída = 1

    let y = 26;
    // ===== CANHOTO (recebimento) =====
    const canH = 24;
    box(L, y, W - 150, canH);
    doc.font('Helvetica').fontSize(6).fillColor('#000').text(
      `RECEBEMOS DE ${d.emitente.nome || ''} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`,
      L + 3, y + 2.5, { width: W - 150 - 6 });
    doc.text('DATA DE RECEBIMENTO', L + 3, y + 15).text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', L + 120, y + 15);
    box(R - 148, y, 148, canH);
    doc.font('Helvetica-Bold').fontSize(11).text('NF-e', R - 148, y + 3, { width: 148, align: 'center' });
    doc.font('Helvetica').fontSize(7).text(`Nº ${d.numero}    SÉRIE ${d.serie}`, R - 148, y + 15, { width: 148, align: 'center' });
    y += canH + 2;
    doc.moveTo(L, y).lineTo(R, y).dash(2, { space: 2 }).strokeColor('#999').stroke().undash();
    y += 4;

    // ===== CABEÇALHO: EMITENTE | DANFE | CHAVE =====
    const hH = 74;
    const emW = W * 0.40, daW = W * 0.20, chW = W - emW - daW;
    // Emitente
    box(L, y, emW, hH);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000').text(d.emitente.nome || '—', L + 5, y + 8, { width: emW - 10 });
    doc.font('Helvetica').fontSize(7).fillColor('#333').text(d.emitente.endereco || '', L + 5, y + 26, { width: emW - 10 });
    doc.text([d.emitente.cnpj ? `CNPJ: ${d.emitente.cnpj}` : null, d.emitente.ie ? `IE: ${d.emitente.ie}` : null].filter(Boolean).join('   '), L + 5, y + hH - 16, { width: emW - 10 });
    // DANFE (centro)
    const dx = L + emW;
    box(dx, y, daW, hH);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('DANFE', dx, y + 6, { width: daW, align: 'center' });
    doc.font('Helvetica').fontSize(5.5).text('Documento Auxiliar da Nota Fiscal Eletrônica', dx + 4, y + 20, { width: daW - 8, align: 'center' });
    // caixa 0/1 entrada-saída
    box(dx + daW / 2 - 12, y + 32, 24, 16);
    doc.font('Helvetica-Bold').fontSize(11).text(tipoNum, dx + daW / 2 - 12, y + 35, { width: 24, align: 'center' });
    doc.font('Helvetica').fontSize(5.5).text('0-ENTRADA', dx + 3, y + 34, { width: daW / 2 - 14, align: 'left' }).text('1-SAÍDA', dx + 3, y + 41, { width: daW / 2 - 14, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(7).text(`Nº ${d.numero}`, dx, y + 52, { width: daW, align: 'center' }).text(`SÉRIE ${d.serie}   FL 1/1`, dx, y + 62, { width: daW, align: 'center' });
    // Chave (direita)
    const cx = dx + daW;
    box(cx, y, chW, hH);
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#b03a2e').text('CHAVE DE ACESSO', cx + 4, y + 6, { width: chW - 8 });
    doc.font('Helvetica').fontSize(8).fillColor('#000').text('— prévia: chave gerada somente após a autorização da SEFAZ —', cx + 4, y + 16, { width: chW - 8 });
    doc.fontSize(6).fillColor('#555').text('Consulte pela chave de acesso em www.nfe.fazenda.gov.br/portal (após autorizar)', cx + 4, y + 40, { width: chW - 8 });
    y += hH;

    // ===== NATUREZA + PROTOCOLO =====
    campo(L, y, W * 0.62, 22, 'Natureza da operação', d.natureza || '—');
    campo(L + W * 0.62, y, W * 0.38, 22, 'Protocolo de autorização', 'PRÉVIA — sem protocolo (nota não autorizada)', { fs: 6.5 });
    y += 22;
    // ===== IE | IE ST | CNPJ =====
    campo(L, y, W / 3, 18, 'Inscrição estadual', d.emitente.ie || '—');
    campo(L + W / 3, y, W / 3, 18, 'Inscr. estadual do subst. trib.', '—');
    campo(L + (2 * W) / 3, y, W / 3, 18, 'CNPJ', d.emitente.cnpj || '—');
    y += 18;

    // ===== DESTINATÁRIO / REMETENTE =====
    faixa(L, y + 1, W, 'Destinatário / Remetente');
    y += 8;
    campo(L, y, W * 0.60, 20, 'Nome / Razão social', d.destinatario.nome || '—');
    campo(L + W * 0.60, y, W * 0.24, 20, 'CNPJ / CPF', d.destinatario.cnpj || '—');
    campo(L + W * 0.84, y, W * 0.16, 20, 'Data de emissão', dataBR(d.emitidaEm).split(' ')[0] || '—', { fs: 7 });
    y += 20;
    campo(L, y, W * 0.72, 20, 'Endereço', d.destinatario.endereco || '—', { fs: 7 });
    campo(L + W * 0.72, y, W * 0.12, 20, 'Inscr. estadual', d.destinatario.ie || '—', { fs: 7 });
    campo(L + W * 0.84, y, W * 0.16, 20, 'CFOP', d.cfop || '—');
    y += 20;

    // ===== CÁLCULO DO IMPOSTO =====
    faixa(L, y + 1, W, 'Cálculo do imposto');
    y += 8;
    const c5 = W / 5;
    campo(L, y, c5, 20, 'Base de cálc. ICMS', d.totais.baseIcms != null ? money(d.totais.baseIcms) : '—', { align: 'right', fs: 7.5 });
    campo(L + c5, y, c5, 20, 'Valor do ICMS', d.totais.valorIcms != null ? money(d.totais.valorIcms) : '—', { align: 'right', fs: 7.5 });
    campo(L + 2 * c5, y, c5, 20, 'BC ICMS ST', '—', { align: 'right', fs: 7.5 });
    campo(L + 3 * c5, y, c5, 20, 'Valor ICMS ST', '—', { align: 'right', fs: 7.5 });
    campo(L + 4 * c5, y, c5, 20, 'Valor total dos produtos', money(d.totais.produtos), { align: 'right', fs: 7.5, bold: true });
    y += 20;
    const c6 = W / 6;
    campo(L, y, c6, 20, 'Valor do frete', d.totais.frete ? money(d.totais.frete) : money(0), { align: 'right', fs: 7.5 });
    campo(L + c6, y, c6, 20, 'Valor do seguro', money(0), { align: 'right', fs: 7.5 });
    campo(L + 2 * c6, y, c6, 20, 'Desconto', money(0), { align: 'right', fs: 7.5 });
    campo(L + 3 * c6, y, c6, 20, 'Outras despesas', money(0), { align: 'right', fs: 7.5 });
    campo(L + 4 * c6, y, c6, 20, 'Valor do IPI', money(0), { align: 'right', fs: 7.5 });
    campo(L + 5 * c6, y, c6, 20, 'VALOR TOTAL DA NOTA', money(d.totais.total), { align: 'right', fs: 8.5, bold: true });
    y += 20;

    // ===== TRANSPORTADOR =====
    faixa(L, y + 1, W, 'Transportador / Volumes transportados');
    y += 8;
    campo(L, y, W * 0.60, 18, 'Nome / Razão social', '—');
    campo(L + W * 0.60, y, W * 0.20, 18, 'Frete por conta', tipoNum === '1' ? 'conforme pedido' : '—', { fs: 7 });
    campo(L + W * 0.80, y, W * 0.20, 18, 'Placa / UF', '—');
    y += 18;

    // ===== DADOS DOS PRODUTOS / SERVIÇOS =====
    faixa(L, y + 1, W, 'Dados dos produtos / serviços');
    y += 8;
    const cols = [
      { t: 'CÓDIGO', w: 62, a: 'left' as const },
      { t: 'DESCRIÇÃO DO PRODUTO / SERVIÇO', w: 205, a: 'left' as const },
      { t: 'NCM', w: 52, a: 'left' as const },
      { t: 'CFOP', w: 34, a: 'center' as const },
      { t: 'UN', w: 28, a: 'center' as const },
      { t: 'QTDE', w: 44, a: 'right' as const },
      { t: 'V.UNIT', w: 56, a: 'right' as const },
      { t: 'V.TOTAL', w: W - 62 - 205 - 52 - 34 - 28 - 44 - 56, a: 'right' as const },
    ];
    const drawHead = () => {
      doc.rect(L, y, W, 14).fill('#eee');
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(6.5);
      let x = L + 3;
      for (const c of cols) { doc.text(c.t, x, y + 4, { width: c.w - 4, align: c.a, lineBreak: false }); x += c.w; }
      box(L, y, W, 14);
      doc.fillColor('#000').font('Helvetica');
      y += 14;
    };
    drawHead();
    doc.fontSize(7.5);
    for (const it of d.itens) {
      const desc = it.descricao || '';
      const hDesc = doc.heightOfString(desc, { width: cols[1].w - 4 });
      const rowH = Math.max(13, hDesc + 5);
      if (y + rowH > 792) { doc.addPage(); y = 26; drawHead(); doc.fontSize(7.5); }
      let x = L + 3;
      const cells = [
        it.codigo || '—', desc, it.ncm || '—', it.cfop || d.cfop || '—',
        it.unidade || 'UN', String(it.qtd), money(it.vUnit), money(it.vTotal),
      ];
      cells.forEach((val, i) => { doc.fillColor('#000').text(val, x, y + 3, { width: cols[i].w - 4, align: cols[i].a }); x += cols[i].w; });
      doc.moveTo(L, y + rowH).lineTo(R, y + rowH).strokeColor('#ddd').lineWidth(0.4).stroke();
      y += rowH;
    }
    // ===== DADOS ADICIONAIS =====
    y += 6;
    if (y > 720) { doc.addPage(); y = 26; }
    faixa(L, y + 1, W, 'Dados adicionais');
    y += 8;
    box(L, y, W, 54);
    doc.font('Helvetica').fontSize(7.5).fillColor('#333')
      .text(d.infoAdic || 'Documento sem valor fiscal — prévia para conferência.', L + 4, y + 4, { width: W - 8 });
    y += 54;

    // Rodapé
    y += 8;
    if (y > 800) { doc.addPage(); y = 26; }
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#999')
      .text('PRÉVIA gerada pelo ERP no formato do DANFE apenas para conferência. Chave de acesso, protocolo e validade fiscal só existem após a autorização da SEFAZ.', L, y, { width: W, align: 'center' });

    doc.end();
  });
}
