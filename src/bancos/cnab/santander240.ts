/**
 * CNAB 240 — Banco Santander (033) — COBRANÇA (remessa e retorno).
 *
 * Funções PURAS (sem banco de dados): montam/lêem as linhas de 240 posições e
 * calculam nosso número, código de barras e linha digitável no padrão FEBRABAN
 * com o "campo livre" do Santander.
 *
 * Posições seguem o "Layout de Arquivo — Cobrança CNAB 240" do Santander
 * (versão de arquivo 040 / lote 030). Os dados do CONVÊNIO (código de
 * transmissão, código do cedente/beneficiário, carteira) vêm da configuração da
 * conta bancária — nada é inventado aqui. Detalhes específicos podem ser
 * ajustados na homologação do arquivo com o banco (por isso o layout é uma
 * tabela declarativa: mudar uma posição é mudar um número).
 */

export interface CedenteSantander {
  cnpj: string;            // só dígitos
  nome: string;
  agencia: string;         // 4 dígitos
  agenciaDv?: string | null;
  conta: string;           // até 9 dígitos
  contaDv?: string | null;
  codigoCedente: string;   // código do beneficiário (7) — "convênio" na configuração
  codigoTransmissao?: string | null; // 20 posições; se vazio, monta agência+cedente+conta
  carteira: string;        // ex.: "101" (cobrança simples registrada)
  jurosMensal?: number | null;  // % ao mês
  multaPercent?: number | null; // % após vencimento
  diasProtesto?: number | null; // dias p/ protesto; vazio = não protestar
}

export interface TituloRemessa {
  nossoNumero: string;     // 12 dígitos (sem DV)
  seuNumero: string;       // identificação na empresa (até 15)
  valor: number;
  vencimento: Date;
  emissao: Date;
  sacado: {
    tipo: 'CPF' | 'CNPJ';
    documento: string;     // só dígitos
    nome: string;
    endereco: string;
    bairro: string;
    cep: string;           // 8 dígitos
    cidade: string;
    uf: string;
  };
  mensagem?: string;
}

export interface OcorrenciaRetorno {
  nossoNumero: string;     // 12 dígitos (sem DV)
  nossoNumeroDv: string;
  seuNumero: string;
  codigo: string;          // código de movimento (02, 03, 06, 09, 17…)
  descricao: string;
  motivos: string[];       // códigos de motivo (rejeição/tarifa)
  valorTitulo: number;
  valorPago: number;       // segmento U
  valorLiquido: number;
  juros: number;
  desconto: number;
  tarifa: number;
  dataOcorrencia: Date | null;
  dataCredito: Date | null;
  linha: number;
}

// ---------- utilitários de formatação ----------
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const semAcento = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Alfanumérico: maiúsculo, sem acento, alinhado à esquerda, preenchido com espaço. */
export const alfa = (s: unknown, len: number) => semAcento(s).toUpperCase().replace(/[^A-Z0-9 .,\/\-&]/g, ' ').slice(0, len).padEnd(len, ' ');
/** Numérico: só dígitos, alinhado à direita, preenchido com zero. */
export const num = (s: unknown, len: number) => soDigitos(s).slice(-len).padStart(len, '0');
/** Valor com 2 decimais implícitas (ex.: 1234.5 -> "000000000123450"). */
export const valor = (v: number, len: number) => num(Math.round((v || 0) * 100), len);
const ddmmaaaa = (d: Date | null | undefined) => (d ? `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}` : '00000000');
const lerData = (s: string): Date | null => {
  const t = soDigitos(s);
  if (t.length !== 8 || t === '00000000') return null;
  const d = new Date(Number(t.slice(4, 8)), Number(t.slice(2, 4)) - 1, Number(t.slice(0, 2)));
  return isNaN(d.getTime()) ? null : d;
};
const lerValor = (s: string) => Number(soDigitos(s) || '0') / 100;

// ---------- dígitos verificadores ----------
/**
 * DV do nosso número Santander — módulo 11, pesos 2..9 da direita para a esquerda.
 * Regra do manual H7815: resto 0 => DV 0, resto 1 => DV 0, demais => 11 - resto
 * (resto 10 cai em 1 pela própria fórmula). Exemplo do manual: 4870184 => 48701840.
 */
export function dvNossoNumeroSantander(nn12: string): string {
  const d = num(nn12, 12);
  let peso = 2, soma = 0;
  for (let i = d.length - 1; i >= 0; i--) { soma += Number(d[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return String(r === 0 || r === 1 ? 0 : 11 - r);
}
/** Módulo 10 (pesos 2,1…) dos campos da linha digitável. */
export function mod10(s: string): string {
  let peso = 2, soma = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const p = Number(s[i]) * peso;
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    peso = peso === 2 ? 1 : 2;
  }
  return String((10 - (soma % 10)) % 10);
}
/** DV geral do código de barras (módulo 11, pesos 2..9): 0, 10 ou 11 viram 1. */
export function dvCodigoBarras(s43: string): string {
  let peso = 2, soma = 0;
  for (let i = s43.length - 1; i >= 0; i--) { soma += Number(s43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const dv = 11 - (soma % 11);
  return String(dv === 0 || dv === 10 || dv === 11 ? 1 : dv);
}

/** Fator de vencimento FEBRABAN: dias desde 07/10/1997; reinicia em 1000 quando passa de 9999 (22/02/2025). */
export function fatorVencimento(venc: Date): string {
  const base = Date.UTC(1997, 9, 7);
  const dia = Date.UTC(venc.getFullYear(), venc.getMonth(), venc.getDate());
  let f = Math.round((dia - base) / 86400000);
  while (f > 9999) f -= 9000;
  return String(f).padStart(4, '0');
}

/** Campo livre Santander (25): 9 + código do cedente (7) + nosso número c/ DV (13) + IOS (1) + carteira (3). */
export function campoLivreSantander(c: CedenteSantander, nossoNumero12: string): string {
  const nn = num(nossoNumero12, 12) + dvNossoNumeroSantander(nossoNumero12);
  return '9' + num(c.codigoCedente, 7) + nn + '0' + num(c.carteira, 3);
}

/** Código de barras (44) e linha digitável (47) do boleto. */
export function codigoBarrasELinha(c: CedenteSantander, nossoNumero12: string, valorTitulo: number, venc: Date) {
  const livre = campoLivreSantander(c, nossoNumero12);
  const semDv = '033' + '9' + fatorVencimento(venc) + valor(valorTitulo, 10) + livre; // 3+1+4+10+25 = 43
  const dv = dvCodigoBarras(semDv);
  const barras = semDv.slice(0, 4) + dv + semDv.slice(4);
  const c1 = '0339' + livre.slice(0, 5), c2 = livre.slice(5, 15), c3 = livre.slice(15, 25);
  const f = (s: string) => (s + mod10(s));
  const l1 = f(c1), l2 = f(c2), l3 = f(c3);
  const linha = `${l1.slice(0, 5)}.${l1.slice(5)} ${l2.slice(0, 5)}.${l2.slice(5)} ${l3.slice(0, 5)}.${l3.slice(5)} ${dv} ${fatorVencimento(venc)}${valor(valorTitulo, 10)}`;
  return { codigoBarras: barras, linhaDigitavel: linha, nossoNumeroDv: dvNossoNumeroSantander(nossoNumero12) };
}

/**
 * Código de transmissão (15 posições). O manual H7815 (Nota 3) é explícito:
 * "Informação cedida pelo banco que identifica o arquivo remessa do cliente" —
 * NÃO se monta a partir de agência/conta. Sem ele o arquivo é rejeitado, por isso
 * a geração da remessa exige o valor configurado (ver BancosService.faltando()).
 */
export function codigoTransmissao(c: CedenteSantander): string {
  return num(soDigitos(c.codigoTransmissao), 15);
}

// ---------- REMESSA ----------
const CRLF = '\r\n';
function linha240(partes: Array<[number, number, string]>): string {
  // partes: [posiçãoInicial(1-based), tamanho, conteúdo já formatado]
  const buf = Array(240).fill(' ');
  for (const [ini, len, txt] of partes) {
    const s = String(txt).padEnd(len, ' ').slice(0, len);
    for (let i = 0; i < len; i++) buf[ini - 1 + i] = s[i];
  }
  return buf.join('');
}

export interface RemessaGerada { conteudo: string; nomeArquivo: string; qtdRegistros: number }

/**
 * Monta o arquivo de remessa de cobrança (entrada de títulos, movimento "01").
 * @param nsa nº sequencial do arquivo (NSA) — controle da conta bancária
 */
export function gerarRemessaSantander240(c: CedenteSantander, titulos: TituloRemessa[], nsa: number, dataGeracao = new Date()): RemessaGerada {
  const cnpj = num(c.cnpj, 15);
  const transm = codigoTransmissao(c);
  const linhas: string[] = [];

  // Header de arquivo (registro 0). H7815: código de transmissão em 033-047 (15) e
  // 048-072 em BRANCO — preencher os 20 bytes do FEBRABAN "puro" aqui é rejeição clássica.
  linhas.push(linha240([
    [1, 3, '033'], [4, 4, '0000'], [8, 1, '0'], [9, 8, ''], [17, 1, '2'], [18, 15, cnpj], [33, 15, transm], [48, 25, ''],
    [73, 30, alfa(c.nome, 30)], [103, 30, alfa('BANCO SANTANDER', 30)], [133, 10, ''], [143, 1, '1'], [144, 8, ddmmaaaa(dataGeracao)],
    [152, 6, ''], [158, 6, num(nsa, 6)], [164, 3, '040'], [167, 74, ''],
  ]));
  // Header de lote (registro 1) — serviço 01 cobrança, operação R remessa.
  // H7815: 034-053 brancos, código de transmissão em 054-068 (15), 069-073 brancos.
  linhas.push(linha240([
    [1, 3, '033'], [4, 4, '0001'], [8, 1, '1'], [9, 1, 'R'], [10, 2, '01'], [12, 2, ''], [14, 3, '030'], [17, 1, ''], [18, 1, '2'], [19, 15, cnpj],
    [34, 20, ''], [54, 15, transm], [69, 5, ''], [74, 30, alfa(c.nome, 30)], [104, 40, ''], [144, 40, ''], [184, 8, num(nsa, 8)], [192, 8, ddmmaaaa(dataGeracao)], [200, 41, ''],
  ]));

  let seq = 0;
  const juros = c.jurosMensal && c.jurosMensal > 0 ? c.jurosMensal : 0;
  const protesto = c.diasProtesto && c.diasProtesto > 0 ? c.diasProtesto : 0;
  for (const t of titulos) {
    const nn13 = num(t.nossoNumero, 12) + dvNossoNumeroSantander(t.nossoNumero);
    const jurosDia = juros > 0 ? (t.valor * (juros / 100)) / 30 : 0; // código 1 = valor por dia
    seq++;
    // Segmento P — dados do título
    linhas.push(linha240([
      [1, 3, '033'], [4, 4, '0001'], [8, 1, '3'], [9, 5, num(seq, 5)], [14, 1, 'P'], [15, 1, ''], [16, 2, '01'],
      [18, 4, num(c.agencia, 4)], [22, 1, num(c.agenciaDv || '0', 1)], [23, 9, num(c.conta, 9)], [32, 1, num(c.contaDv || '0', 1)],
      [33, 9, num(c.conta, 9)], [42, 1, num(c.contaDv || '0', 1)], [43, 2, ''], [45, 13, nn13], [58, 2, ''],
      [60, 1, '1'], [61, 1, '1'], [62, 1, '2'], [63, 2, ''], [65, 15, alfa(t.seuNumero, 15)], [80, 8, ddmmaaaa(t.vencimento)], [88, 15, valor(t.valor, 15)],
      [103, 4, '0000'], [107, 1, '0'], [108, 1, ''], [109, 2, '02'], [111, 1, 'N'], [112, 8, ddmmaaaa(t.emissao)],
      [120, 1, juros > 0 ? '1' : '3'], [121, 8, juros > 0 ? ddmmaaaa(new Date(t.vencimento.getTime() + 86400000)) : '00000000'], [129, 15, valor(jurosDia, 15)],
      [144, 1, '0'], [145, 8, '00000000'], [153, 15, valor(0, 15)], [168, 15, valor(0, 15)], [183, 15, valor(0, 15)],
      [198, 25, alfa(t.seuNumero, 25)], [223, 1, protesto ? '1' : '3'], [224, 2, num(protesto, 2)], [226, 1, '2'], [227, 1, ''], [228, 2, '00'], [230, 2, '00'], [232, 9, ''],
    ]));
    seq++;
    // Segmento Q — sacado (pagador)
    const s = t.sacado;
    linhas.push(linha240([
      [1, 3, '033'], [4, 4, '0001'], [8, 1, '3'], [9, 5, num(seq, 5)], [14, 1, 'Q'], [15, 1, ''], [16, 2, '01'],
      [18, 1, s.tipo === 'CPF' ? '1' : '2'], [19, 15, num(s.documento, 15)], [34, 40, alfa(s.nome, 40)], [74, 40, alfa(s.endereco, 40)],
      [114, 15, alfa(s.bairro, 15)], [129, 5, num(s.cep, 8).slice(0, 5)], [134, 3, num(s.cep, 8).slice(5, 8)], [137, 15, alfa(s.cidade, 15)], [152, 2, alfa(s.uf, 2)],
      [154, 1, '0'], [155, 15, num('', 15)], [170, 40, ''], [210, 3, '000'], [213, 3, '000'], [216, 3, '000'], [219, 3, '000'], [222, 19, ''],
    ]));
    // Segmento R — multa (só quando configurada)
    if (c.multaPercent && c.multaPercent > 0) {
      seq++;
      linhas.push(linha240([
        [1, 3, '033'], [4, 4, '0001'], [8, 1, '3'], [9, 5, num(seq, 5)], [14, 1, 'R'], [15, 1, ''], [16, 2, '01'],
        [18, 1, '0'], [19, 8, '00000000'], [27, 15, valor(0, 15)], [42, 1, '0'], [43, 8, '00000000'], [51, 15, valor(0, 15)],
        [66, 1, '2'], [67, 8, ddmmaaaa(new Date(t.vencimento.getTime() + 86400000))], [75, 15, valor(c.multaPercent, 15)], [90, 151, ''],
      ]));
    }
  }
  // Trailer de lote (5): qtd = header lote + segmentos + trailer lote
  linhas.push(linha240([[1, 3, '033'], [4, 4, '0001'], [8, 1, '5'], [9, 9, ''], [18, 6, num(seq + 2, 6)], [24, 217, '']]));
  // Trailer de arquivo (9)
  linhas.push(linha240([[1, 3, '033'], [4, 4, '9999'], [8, 1, '9'], [9, 9, ''], [18, 6, '000001'], [24, 6, num(linhas.length + 1, 6)], [30, 211, '']]));

  const d = dataGeracao;
  const nome = `CB${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(nsa % 100).padStart(2, '0')}.REM`;
  return { conteudo: linhas.join(CRLF) + CRLF, nomeArquivo: nome, qtdRegistros: linhas.length };
}

// ---------- RETORNO ----------
export const MOVIMENTOS_RETORNO: Record<string, string> = {
  '02': 'Entrada confirmada', '03': 'Entrada rejeitada', '04': 'Transferência de carteira/entrada', '05': 'Transferência de carteira/baixa',
  '06': 'Liquidação', '09': 'Baixa', '11': 'Títulos em carteira (em ser)', '12': 'Confirmação de abatimento', '13': 'Confirmação de cancelamento de abatimento',
  '14': 'Confirmação de alteração de vencimento', '17': 'Liquidação após baixa ou título não registrado', '19': 'Confirmação de instrução de protesto',
  '20': 'Confirmação de sustação de protesto', '23': 'Remessa a cartório', '24': 'Retirada de cartório', '25': 'Protestado e baixado',
  '26': 'Instrução rejeitada', '27': 'Confirmação de alteração de dados', '28': 'Débito de tarifas/custas', '29': 'Ocorrências do pagador',
  '30': 'Alteração de dados rejeitada', '32': 'Código de IOF inválido', '51': 'Título DDA reconhecido pelo pagador', '52': 'Título DDA não reconhecido',
};
export const LIQUIDACOES = new Set(['06', '17']);
export const BAIXAS = new Set(['09', '25']);
export const REJEICOES = new Set(['03', '26', '30']);

/** Lê um arquivo de retorno CNAB 240 (segmentos T + U) e devolve as ocorrências. */
export function lerRetornoSantander240(conteudo: string): { banco: string; nsa: string; dataGeracao: Date | null; ocorrencias: OcorrenciaRetorno[] } {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length >= 200);
  if (!linhas.length) throw new Error('Arquivo de retorno vazio ou inválido (linhas de 240 posições esperadas).');
  const h = linhas[0];
  const banco = h.slice(0, 3);
  const nsa = h.slice(157, 163).trim();
  const dataGeracao = lerData(h.slice(143, 151));
  const ocorrencias: OcorrenciaRetorno[] = [];
  let atual: OcorrenciaRetorno | null = null;
  linhas.forEach((l, idx) => {
    if (l[7] !== '3') return;
    const seg = l[13];
    if (seg === 'T') {
      const nn13 = l.slice(44, 57);
      atual = {
        nossoNumero: nn13.slice(0, 12), nossoNumeroDv: nn13.slice(12, 13),
        seuNumero: l.slice(58, 73).trim(),
        codigo: l.slice(15, 17), descricao: MOVIMENTOS_RETORNO[l.slice(15, 17)] || 'Ocorrência ' + l.slice(15, 17),
        motivos: (l.slice(213, 223).match(/.{2}/g) || []).map((m) => m.trim()).filter((m) => m && m !== '00'),
        valorTitulo: lerValor(l.slice(81, 96)), valorPago: 0, valorLiquido: 0, juros: 0, desconto: 0,
        tarifa: lerValor(l.slice(198, 213)), dataOcorrencia: null, dataCredito: null, linha: idx + 1,
      };
      ocorrencias.push(atual);
    } else if (seg === 'U' && atual) {
      atual.juros = lerValor(l.slice(17, 32));
      atual.desconto = lerValor(l.slice(32, 47));
      atual.valorPago = lerValor(l.slice(77, 92));
      atual.valorLiquido = lerValor(l.slice(92, 107));
      atual.dataOcorrencia = lerData(l.slice(137, 145));
      atual.dataCredito = lerData(l.slice(145, 153));
      atual = null;
    }
  });
  return { banco, nsa, dataGeracao, ocorrencias };
}
