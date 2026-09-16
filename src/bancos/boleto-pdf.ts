/**
 * Boleto bancário em PDF (recibo do pagador + ficha de compensação) com o código
 * de barras ITF (2 de 5 intercalado) desenhado — padrão FEBRABAN.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

export interface DadosBoletoPdf {
  banco: { codigo: string; nome: string }; // "033" / "Santander"
  beneficiario: { nome: string; cnpj: string; endereco: string; agenciaConta: string; codigoCedente: string };
  pagador: { nome: string; documento: string; endereco: string };
  nossoNumero: string;      // 12+DV formatado "000000000123-4"
  seuNumero: string;
  carteira: string;
  especie: string;          // "DM"
  aceite: string;           // "N"
  dataDocumento: Date;
  dataProcessamento: Date;
  vencimento: Date;
  valor: number;
  linhaDigitavel: string;
  codigoBarras: string;
  instrucoes: string[];
}

const fmtData = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const fmtMoeda = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDoc = (s: string) => { const d = s.replace(/\D/g, ''); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : s; };

/** Padrões ITF: n = barra/espaço estreito, w = largo. */
const ITF: Record<string, string> = { '0': 'nnwwn', '1': 'wnnnw', '2': 'nwnnw', '3': 'wwnnn', '4': 'nnwnw', '5': 'wnwnn', '6': 'nwwnn', '7': 'nnnww', '8': 'wnnwn', '9': 'nwnwn' };

/** Desenha o código de barras 2 de 5 intercalado (44 dígitos) em (x, y). */
function desenharITF(doc: any, codigo: string, x: number, y: number, altura: number, estreito = 1.2) {
  const largo = estreito * 3;
  let px = x;
  const barra = (w: number) => { doc.rect(px, y, w, altura).fill('#000'); px += w; };
  const espaco = (w: number) => { px += w; };
  barra(estreito); espaco(estreito); barra(estreito); espaco(estreito); // start
  const digitos = codigo.length % 2 ? '0' + codigo : codigo;
  for (let i = 0; i < digitos.length; i += 2) {
    const a = ITF[digitos[i]], b = ITF[digitos[i + 1]];
    for (let k = 0; k < 5; k++) { barra(a[k] === 'w' ? largo : estreito); espaco(b[k] === 'w' ? largo : estreito); }
  }
  barra(largo); espaco(estreito); barra(estreito); // stop
  return px - x;
}

/** Dígito do código do banco (mod 11) — Santander 033-7. */
function dvBanco(codigo: string): string {
  const d = codigo.padStart(3, '0');
  let peso = 2, soma = 0;
  for (let i = d.length - 1; i >= 0; i--) { soma += Number(d[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return String(r === 0 || r === 1 ? 0 : 11 - r);
}

export function gerarBoletoPdf(d: DadosBoletoPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 28, W = 595 - 56, DIR = 150; // margem, largura útil, coluna da direita
    const cinza = '#444', preto = '#000';
    /** Célula com rótulo pequeno e até 2 linhas de valor (a 2ª em fonte menor). */
    const campo = (x: number, y: number, w: number, h: number, rotulo: string, l1: string, opts: { bold?: boolean; size?: number; align?: 'left' | 'right'; l2?: string } = {}) => {
      doc.rect(x, y, w, h).stroke('#000');
      doc.font('Helvetica').fontSize(6).fillColor(cinza).text(rotulo, x + 3, y + 2, { width: w - 6, lineBreak: false });
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 8.5).fillColor(preto)
        .text(l1, x + 3, y + 10, { width: w - 6, align: opts.align || 'left', lineBreak: false, ellipsis: true });
      if (opts.l2) doc.font('Helvetica').fontSize(7).fillColor(preto).text(opts.l2, x + 3, y + 20, { width: w - 6, align: opts.align || 'left', lineBreak: false, ellipsis: true });
    };
    const cabecalho = (y: number, direita: string) => {
      doc.font('Helvetica-Bold').fontSize(16).fillColor(preto).text(d.banco.nome, L, y, { lineBreak: false });
      doc.rect(L + 110, y - 2, 1, 22).fill('#000');
      doc.font('Helvetica-Bold').fontSize(14).text(d.banco.codigo + '-' + dvBanco(d.banco.codigo), L + 118, y + 1, { lineBreak: false });
      doc.rect(L + 170, y - 2, 1, 22).fill('#000');
      doc.font('Helvetica-Bold').fontSize(direita.length > 20 ? 10.5 : 11).text(direita, L + 178, y + 4, { width: W - 178, align: 'right', lineBreak: false });
      doc.rect(L, y + 22, W, 1).fill('#000');
      return y + 26;
    };
    const benefL1 = `${d.beneficiario.nome} — CNPJ ${fmtDoc(d.beneficiario.cnpj)}`;
    const agCed = d.beneficiario.agenciaConta;
    const cedente = `Cód. beneficiário ${d.beneficiario.codigoCedente}`;
    const pagL1 = `${d.pagador.nome} — ${fmtDoc(d.pagador.documento)}`;

    // ===== Recibo do pagador =====
    let y = cabecalho(L, 'Recibo do Pagador');
    campo(L, y, W - DIR, 30, 'Beneficiário', benefL1, { l2: d.beneficiario.endereco });
    campo(L + W - DIR, y, DIR, 30, 'Agência / Conta · Código do beneficiário', agCed, { align: 'right', l2: cedente });
    y += 30;
    campo(L, y, 110, 24, 'Data do documento', fmtData(d.dataDocumento));
    campo(L + 110, y, 150, 24, 'Nº do documento', d.seuNumero);
    campo(L + 260, y, 60, 24, 'Espécie', d.especie);
    campo(L + 320, y, 50, 24, 'Aceite', d.aceite);
    campo(L + 370, y, W - 370, 24, 'Nosso número', d.nossoNumero, { align: 'right' });
    y += 24;
    campo(L, y, W - DIR, 30, 'Pagador', pagL1, { l2: d.pagador.endereco });
    campo(L + W - DIR, y, DIR, 30, 'Vencimento', fmtData(d.vencimento), { bold: true, align: 'right', size: 10 });
    y += 30;
    campo(L, y, W - DIR, 24, 'Linha digitável', d.linhaDigitavel, { bold: true, size: 9.5 });
    campo(L + W - DIR, y, DIR, 24, 'Valor do documento', fmtMoeda(d.valor), { bold: true, align: 'right', size: 10 });
    y += 30;
    doc.font('Helvetica').fontSize(7).fillColor(cinza).text('Autenticação mecânica — Recibo do Pagador', L, y, { width: W, align: 'right' });
    y += 18;
    doc.moveTo(L, y).lineTo(L + W, y).dash(3, { space: 3 }).stroke('#000').undash();
    y += 14;

    // ===== Ficha de compensação =====
    y = cabecalho(y, d.linhaDigitavel);
    campo(L, y, W - DIR, 24, 'Local de pagamento', 'PAGÁVEL EM QUALQUER BANCO ATÉ O VENCIMENTO');
    campo(L + W - DIR, y, DIR, 24, 'Vencimento', fmtData(d.vencimento), { bold: true, align: 'right', size: 10 });
    y += 24;
    campo(L, y, W - DIR, 30, 'Beneficiário', benefL1, { l2: d.beneficiario.endereco });
    campo(L + W - DIR, y, DIR, 30, 'Agência / Conta · Código do beneficiário', agCed, { align: 'right', l2: cedente });
    y += 30;
    campo(L, y, 100, 24, 'Data do documento', fmtData(d.dataDocumento));
    campo(L + 100, y, 130, 24, 'Nº do documento', d.seuNumero);
    campo(L + 230, y, 55, 24, 'Espécie doc.', d.especie);
    campo(L + 285, y, 40, 24, 'Aceite', d.aceite);
    campo(L + 325, y, W - DIR - 325, 24, 'Data processamento', fmtData(d.dataProcessamento));
    campo(L + W - DIR, y, DIR, 24, 'Nosso número', d.nossoNumero, { align: 'right' });
    y += 24;
    campo(L, y, 100, 24, 'Uso do banco', '');
    campo(L + 100, y, 60, 24, 'Carteira', d.carteira);
    campo(L + 160, y, 55, 24, 'Espécie', 'R$');
    campo(L + 215, y, 90, 24, 'Quantidade', '');
    campo(L + 305, y, W - DIR - 305, 24, 'Valor', '');
    campo(L + W - DIR, y, DIR, 24, '(=) Valor do documento', fmtMoeda(d.valor), { bold: true, align: 'right', size: 10 });
    y += 24;
    const hInstr = 5 * 20;
    doc.rect(L, y, W - DIR, hInstr).stroke('#000');
    doc.font('Helvetica').fontSize(6).fillColor(cinza).text('Instruções (texto de responsabilidade do beneficiário)', L + 3, y + 2);
    doc.font('Helvetica').fontSize(8).fillColor(preto).text(d.instrucoes.join('\n'), L + 3, y + 12, { width: W - DIR - 6, height: hInstr - 14 });
    ['(-) Desconto / Abatimento', '(-) Outras deduções', '(+) Mora / Multa', '(+) Outros acréscimos', '(=) Valor cobrado'].forEach((r, i) => campo(L + W - DIR, y + i * 20, DIR, 20, r, ''));
    y += hInstr;
    campo(L, y, W, 30, 'Pagador', pagL1, { l2: d.pagador.endereco });
    y += 30;
    doc.font('Helvetica').fontSize(7).fillColor(cinza).text('Sacador/Avalista: —', L + 3, y + 3, { lineBreak: false });
    doc.text('Autenticação mecânica — Ficha de Compensação', L, y + 3, { width: W, align: 'right' });
    y += 18;
    desenharITF(doc, d.codigoBarras, L, y, 50);
    doc.end();
  });
}
