/**
 * ETIQUETA DE COMPOSIÇÃO — a etiqueta costurada dentro da peça.
 *
 * É a etiqueta que fica com o cliente final e responde, anos depois, três
 * perguntas: de que é feita a peça, que tamanho é, e QUEM a fabricou. A
 * concorrência (Kaballah) imprime também o número da ordem de produção, e é
 * disso que nasce a rastreabilidade: com a OP na etiqueta, uma peça devolvida
 * volta até o corte, o tecido, o lote e a data.
 *
 * Aqui só tem função pura: montar o texto, montar o ZPL e dizer o que falta
 * para a etiqueta poder ser impressa. Quem lê o banco e grava é o service —
 * assim esta parte, que é a que vai ser ajustada contra a impressora de
 * verdade, é testável sem banco e sem impressora.
 *
 * SÍMBOLOS DE CONSERVAÇÃO (lavar/passar/alvejar): NÃO são impressos aqui.
 * ZPL não tem fonte com esses pictogramas; eles vêm pré-impressos na fita ou
 * precisam entrar como imagem monocromática (^GF). Enquanto a imagem não
 * existe, a etiqueta sai sem eles e `conferirEtiqueta` avisa — é melhor avisar
 * do que imprimir calado uma etiqueta incompleta.
 */

/** Dados do fabricante: saem da filial dona da OP. */
export type FabricanteEtiqueta = {
  nome: string;
  cnpj: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
};

export type DadosEtiquetaComposicao = {
  fabricante: FabricanteEtiqueta;
  /** Número da OP — o que torna a peça rastreável. */
  op: string;
  codigoProduto?: string | null;
  descricaoProduto?: string | null;
  composicao: string | null;
  tamanho: string;
  /** Quantas etiquetas imprimir desta linha. */
  quantidade: number;
  /** Data da impressão (entra no QR). */
  data: Date;
};

/** Uma linha da obrigação: o que a OP deve de um tamanho. */
export type PendenciaEtiqueta = {
  tamanho: string;
  devidas: number;
  impressas: number;
};

/** CNPJ em 00.000.000/0000-00; devolve como veio se não tiver 14 dígitos. */
export function formatarCnpj(cnpj: string | null | undefined): string {
  const d = String(cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14) return String(cnpj ?? '').trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Rótulo do tamanho na tela e na etiqueta. OP sem grade usa a chave vazia. */
export function rotuloTamanho(t: string): string {
  return String(t ?? '').trim() || 'ÚNICO';
}

/**
 * O que ainda falta imprimir, tamanho a tamanho.
 *
 * Nunca devolve número negativo: imprimir a mais (a etiqueta rasgou, a
 * impressora comeu três) é normal no chão de fábrica e não pode virar uma
 * pendência de "-3" que o sistema fica cobrando para sempre.
 */
export function faltamImprimir(linhas: PendenciaEtiqueta[]): Array<{ tamanho: string; faltam: number }> {
  return linhas
    .map((l) => ({ tamanho: l.tamanho, faltam: Math.max(0, Number(l.devidas) - Number(l.impressas)) }))
    .filter((x) => x.faltam > 0);
}

/** Total de etiquetas que ainda faltam na OP inteira. */
export function totalFaltante(linhas: PendenciaEtiqueta[]): number {
  return faltamImprimir(linhas).reduce((s, x) => s + x.faltam, 0);
}

/**
 * O recado que trava a conclusão da OP.
 *
 * Diz o número exato que falta por tamanho, porque "faltam etiquetas" manda a
 * pessoa procurar — e quem está fechando a ordem está com a peça na mão.
 */
export function recadoPendencia(op: string, linhas: PendenciaEtiqueta[]): string {
  const faltam = faltamImprimir(linhas);
  const total = faltam.reduce((s, x) => s + x.faltam, 0);
  const detalhe = faltam.map((x) => `${rotuloTamanho(x.tamanho)}: ${x.faltam}`).join(', ');
  return (
    `A ${op} ainda deve ${total} etiqueta(s) de composição (${detalhe}). ` +
    'A peça não pode ser etiquetada para o estoque sem a etiqueta de composição costurada. ' +
    'Imprima em Produção › Etiquetas de composição — ou feche sem etiqueta, informando o motivo.'
  );
}

/**
 * O que impede esta etiqueta de ser impressa corretamente.
 *
 * Lista em português, para a tela mostrar antes de alguém gastar fita com uma
 * etiqueta errada. Composição em branco é o caso comum: 121 dos 289 produtos
 * de produção não tinham o campo preenchido quando isto foi escrito.
 */
export function conferirEtiqueta(d: DadosEtiquetaComposicao): string[] {
  const p: string[] = [];
  if (!String(d.composicao ?? '').trim()) {
    p.push('composição do tecido não está cadastrada no produto — sem ela a etiqueta sai sem a informação obrigatória');
  }
  if (!String(d.fabricante.cnpj ?? '').replace(/\D/g, '')) {
    p.push('a filial da OP está sem CNPJ');
  }
  if (!String(d.fabricante.nome ?? '').trim()) p.push('a filial da OP está sem nome');
  if (!String(d.op ?? '').trim()) p.push('a OP está sem número');
  if (!Number.isInteger(d.quantidade) || d.quantidade < 1) p.push('quantidade de etiquetas inválida');
  return p;
}

// ===================== ZPL =====================

/** 203 dpi = 8 pontos por mm. Etiqueta de 40 x 60 mm. */
const DPMM = 8;
const LARGURA_MM = 40;
const ALTURA_MM = 60;
const LARGURA = LARGURA_MM * DPMM; // 320
const ALTURA = ALTURA_MM * DPMM;   // 480

/** Texto que entra no ZPL: `^` e `~` são comandos, não podem ir como dado. */
function zpl(v: string | number | null | undefined, max = 32): string {
  return String(v ?? '').replace(/[\^~]/g, ' ').trim().slice(0, max);
}

/**
 * Quebra um texto em linhas que caibam na largura da etiqueta.
 *
 * A composição é o campo que estoura: "50% POLIÉSTER / 50% ALGODÃO" não cabe
 * numa linha de 40 mm na fonte que a torna legível. Quebrar por PALAVRA, e não
 * por caractere, para não cortar "POLIÉS-TER" no meio.
 */
export function quebrarLinhas(texto: string, porLinha: number, maxLinhas: number): string[] {
  const palavras = String(texto ?? '').trim().split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = '';
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (tentativa.length <= porLinha) { atual = tentativa; continue; }
    if (atual) linhas.push(atual);
    atual = p.length > porLinha ? p.slice(0, porLinha) : p;
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, maxLinhas);
}

/**
 * O ZPL da etiqueta.
 *
 * `^PQ` no fim manda a impressora repetir a etiqueta a quantidade pedida — é
 * uma peça, uma etiqueta. Mandar N cópias pela impressora, e não gerar N
 * etiquetas no ZPL, mantém o arquivo pequeno e deixa a impressora fazer o que
 * ela faz melhor.
 */
export function montarZplComposicao(d: DadosEtiquetaComposicao): string {
  const qr = JSON.stringify({
    op: zpl(d.op, 20),
    prod: zpl(d.codigoProduto, 20),
    tam: zpl(d.tamanho, 8),
    data: d.data.toISOString().slice(0, 10),
    v: '1',
  }).replace(/[\^~]/g, ' ');

  const comp = quebrarLinhas(String(d.composicao ?? '').toUpperCase(), 26, 2);
  const linhas: string[] = ['^XA', '^CI28', `^PW${LARGURA}`, `^LL${ALTURA}`];

  let y = 14;
  // Marca
  linhas.push('^CF0,40', `^FO0,${y}^FB${LARGURA},1,0,C,0^FD${zpl(d.fabricante.nome ? 'HC' : '')}^FS`);
  y += 46;
  linhas.push('^CF0,22', `^FO0,${y}^FB${LARGURA},2,0,C,0^FD${zpl(d.fabricante.nome, 40)}^FS`);
  y += 52;
  linhas.push('^CF0,18', `^FO0,${y}^FB${LARGURA},1,0,C,0^FDCNPJ: ${zpl(formatarCnpj(d.fabricante.cnpj), 22)}^FS`);
  y += 26;

  // Composição — a informação obrigatória.
  linhas.push('^CF0,20');
  for (const l of comp) { linhas.push(`^FO0,${y}^FB${LARGURA},1,0,C,0^FD${zpl(l, 30)}^FS`); y += 24; }
  if (!comp.length) { linhas.push(`^FO0,${y}^FB${LARGURA},1,0,C,0^FDCOMPOSICAO NAO CADASTRADA^FS`); y += 24; }
  y += 6;

  // Tamanho, em corpo grande: é o que a pessoa procura na peça.
  linhas.push('^CF0,20', `^FO0,${y}^FB${LARGURA},1,0,C,0^FDTAMANHO^FS`);
  y += 24;
  linhas.push('^CF0,46', `^FO0,${y}^FB${LARGURA},1,0,C,0^FD${zpl(rotuloTamanho(d.tamanho), 10)}^FS`);
  y += 54;

  linhas.push('^CF0,18', `^FO0,${y}^FB${LARGURA},1,0,C,0^FDFABRICADO NO BRASIL^FS`);
  y += 22;
  const contato = [d.fabricante.telefone, d.fabricante.site].filter(Boolean).map((x) => zpl(x, 30));
  for (const c of contato) { linhas.push(`^FO0,${y}^FB${LARGURA},1,0,C,0^FD${c}^FS`); y += 20; }

  // O QR e o número da OP, lado a lado, na base: é o par que rastreia a peça.
  const yBase = Math.min(ALTURA - 96, Math.max(y + 6, ALTURA - 110));
  linhas.push(`^FO14,${yBase}^BQN,2,3^FDLA,${qr}^FS`);
  linhas.push('^CF0,24', `^FO110,${yBase + 24}^FD${zpl(d.op, 16)}^FS`);

  linhas.push(`^PQ${Math.max(1, Math.trunc(d.quantidade))}`, '^XZ');
  return linhas.join('\n');
}
