/**
 * LEITOR DE EXTRATO OFX (Open Financial Exchange).
 *
 * Todo banco brasileiro exporta extrato em OFX pelo internet banking — é o
 * formato que não depende de convênio, de homologação nem de credencial
 * nenhuma. Por isso ele é a primeira camada do espelhamento: funciona hoje,
 * em qualquer banco, e é o mesmo dado que uma API devolveria depois.
 *
 * O arquivo vem em dois dialetos:
 *   OFX 1.x — SGML, tags sem fechamento (<TRNAMT>-150.00 e acabou);
 *   OFX 2.x — XML bem formado.
 * O leitor trata os dois pela mesma regra: valor de uma tag é o texto até a
 * próxima tag. Nada de parser de XML, nada de avaliar conteúdo — o arquivo
 * vem de fora e é tratado como texto, só.
 */

export type LancamentoOfx = {
  /** Identificador único do lançamento no banco (FITID). É a chave anti-duplicata. */
  fitid: string;
  data: Date;
  /** Sempre positivo; o sinal vira `tipo`. */
  valor: number;
  tipo: 'credito' | 'debito';
  descricao: string;
  documento: string | null;
};

export type ExtratoOfx = {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  moeda: string | null;
  periodoIni: Date | null;
  periodoFim: Date | null;
  /** Saldo informado pelo banco no fim do extrato (LEDGERBAL). */
  saldo: number | null;
  saldoEm: Date | null;
  lancamentos: LancamentoOfx[];
};

/** Teto defensivo: o arquivo vem de fora. 12 MB é um extrato de anos. */
const MAX_BYTES = 12 * 1024 * 1024;

/** Valor de uma tag OFX: texto entre `<TAG>` e a próxima `<`. */
function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<]*)`, 'i').exec(bloco);
  if (!m) return null;
  const v = m[1].trim();
  return v === '' ? null : v;
}

/**
 * Data OFX: `AAAAMMDD` com hora e fuso opcionais (`20261029120000[-3:BRT]`).
 * Fica no meio-dia local para a data não "andar" um dia quando o fuso muda.
 */
export function dataOfx(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, a, mes, d] = m;
  const dt = new Date(Number(a), Number(mes) - 1, Number(d), 12, 0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Número OFX. O padrão é ponto decimal, mas banco brasileiro exporta vírgula
 * ("-1.234,56") com alguma frequência — e ler isso como 1.23 seria pior que
 * não ler: entraria no sistema um valor errado, sem erro nenhum.
 */
export function numeroOfx(raw: string | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, '');
  if (!s) return null;
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) {
    // O separador decimal é o que aparece por último.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Lê o extrato. Lança Error com mensagem de gente quando o arquivo não serve. */
export function lerOfx(conteudo: string): ExtratoOfx {
  if (!conteudo || !conteudo.trim()) throw new Error('Arquivo vazio.');
  if (Buffer.byteLength(conteudo, 'utf8') > MAX_BYTES) throw new Error('Arquivo grande demais (máx. 12 MB).');
  const txt = conteudo.replace(/\r/g, '');
  if (!/<OFX>/i.test(txt) && !/<STMTTRN>/i.test(txt)) {
    throw new Error('Não parece um arquivo OFX. Baixe o extrato do banco no formato OFX (ou "Money/OFX").');
  }

  const cab = txt.split(/<BANKTRANLIST>/i)[0] ?? '';
  const banco = tag(cab, 'BANKID');
  const agencia = tag(cab, 'BRANCHID');
  const conta = tag(cab, 'ACCTID');
  const moeda = tag(cab, 'CURDEF');

  const listaM = /<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i.exec(txt);
  const lista = listaM ? listaM[1] : txt;
  const periodoIni = dataOfx(tag(lista, 'DTSTART'));
  const periodoFim = dataOfx(tag(lista, 'DTEND'));

  const bal = /<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i.exec(txt);
  const saldo = bal ? numeroOfx(tag(bal[1], 'BALAMT')) : null;
  const saldoEm = bal ? dataOfx(tag(bal[1], 'DTASOF')) : null;

  const lancamentos: LancamentoOfx[] = [];
  const vistos = new Set<string>();
  // `</STMTTRN>` existe no 2.x e costuma existir no 1.x; quando não existe, o
  // bloco vai até o próximo <STMTTRN> ou até o fim da lista.
  const blocos = [...lista.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|$)/gi)];
  for (const b of blocos) {
    const bloco = b[1];
    const valor = numeroOfx(tag(bloco, 'TRNAMT'));
    const data = dataOfx(tag(bloco, 'DTPOSTED'));
    if (valor == null || data == null) continue; // bloco truncado: não inventa lançamento
    const memo = tag(bloco, 'MEMO');
    const nome = tag(bloco, 'NAME');
    const trntype = (tag(bloco, 'TRNTYPE') || '').toUpperCase();
    const descricao = [nome, memo].filter(Boolean).join(' · ').slice(0, 250)
      || trntype || 'Lançamento sem descrição';
    /**
     * Sem FITID o lançamento não teria chave anti-duplicata, e reimportar o
     * mesmo extrato duplicaria o dinheiro na tela. Então se o banco não mandar,
     * a chave é montada do próprio conteúdo: mesma linha gera a mesma chave.
     */
    let fitid = (tag(bloco, 'FITID') || '').slice(0, 120);
    if (!fitid) {
      fitid = `SEMFITID-${data.toISOString().slice(0, 10)}-${valor.toFixed(2)}-${descricao.slice(0, 40)}`;
    }
    // Dois lançamentos idênticos no MESMO arquivo (acontece: duas tarifas
    // iguais no dia) viram chaves distintas — senão um dos dois sumiria.
    let chave = fitid;
    for (let i = 2; vistos.has(chave); i++) chave = `${fitid}#${i}`;
    vistos.add(chave);

    lancamentos.push({
      fitid: chave,
      data,
      valor: Math.abs(valor),
      tipo: valor < 0 ? 'debito' : 'credito',
      descricao,
      documento: tag(bloco, 'CHECKNUM') || tag(bloco, 'REFNUM') || null,
    });
  }

  if (!lancamentos.length) throw new Error('Nenhum lançamento encontrado no arquivo.');
  lancamentos.sort((a, b) => a.data.getTime() - b.data.getTime());
  return { banco, agencia, conta, moeda, periodoIni, periodoFim, saldo, saldoEm, lancamentos };
}
