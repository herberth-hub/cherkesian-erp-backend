/**
 * CONCILIAÇÃO — ligar o lançamento do banco ao título do ERP.
 *
 * O extrato diz "entraram R$ 1.392,00 em 05/10, TED SANEPAV". O sistema tem
 * títulos a receber. Conciliar é dizer qual título aquele dinheiro pagou.
 *
 * A regra de ouro está no final do arquivo, em `decidirAuto`: o sistema só
 * casa SOZINHO quando a resposta é inequívoca — valor batendo no centavo e um
 * único candidato plausível, com folga sobre o segundo. Tudo o mais vira
 * sugestão ordenada para uma pessoa confirmar com um clique.
 *
 * O motivo é simples: baixa errada é pior que baixa não feita. Um título
 * quitado por engano some da cobrança, e ninguém vai atrás de dinheiro que o
 * sistema diz que já entrou.
 */

export type TituloCandidato = {
  id: number;
  tipo: 'receber' | 'pagar';
  valor: number;
  /** Quanto ainda falta receber/pagar. É contra ele que o valor do banco bate. */
  saldo: number;
  vencimento: Date;
  /** Nº do documento/NF/pedido gravado no título. */
  documento?: string | null;
  /** Nome do cliente/fornecedor — o banco costuma escrever na descrição. */
  parte?: string | null;
  pedidoNumero?: string | null;
};

export type LancamentoParaConciliar = {
  data: Date;
  valor: number;
  tipo: 'credito' | 'debito';
  descricao: string;
  documento?: string | null;
};

export type Sugestao = {
  tituloId: number;
  tipo: 'receber' | 'pagar';
  score: number;
  motivos: string[];
};

/** Texto comparável: sem acento, sem caixa, sem pontuação. */
export function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Palavras com peso de identificação (ignora LTDA, ME, COMERCIO, INDUSTRIA…). */
const VAZIAS = new Set(['LTDA', 'ME', 'EPP', 'SA', 'S', 'A', 'EIRELI', 'COMERCIO', 'COMERCIAL', 'INDUSTRIA', 'INDUSTRIAL', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'CIA']);
export function palavrasFortes(nome: string | null | undefined): string[] {
  return norm(nome).split(' ').filter((p) => p.length >= 4 && !VAZIAS.has(p));
}

/** Números com 3+ dígitos achados no texto (nº de pedido, NF, documento). */
export function numerosDe(texto: string | null | undefined): string[] {
  return [...String(texto ?? '').matchAll(/\d{3,}/g)].map((m) => m[0]);
}

const DIA = 86_400_000;
/** Diferença em dias (positivo = lançamento DEPOIS do vencimento). */
export function diasDe(lanc: Date, venc: Date): number {
  return Math.round((lanc.getTime() - venc.getTime()) / DIA);
}

/**
 * Pontua um título contra o lançamento. Quanto maior, mais provável.
 * Cada ponto ganho vem com um motivo em português — é o que a tela mostra
 * para a pessoa decidir, e o que fica no log depois.
 */
export function pontuar(lanc: LancamentoParaConciliar, t: TituloCandidato): Sugestao {
  const motivos: string[] = [];
  let score = 0;

  // 1. VALOR — é o sinal mais forte que existe num extrato.
  const difSaldo = Math.abs(lanc.valor - t.saldo);
  const difTotal = Math.abs(lanc.valor - t.valor);
  if (difSaldo <= 0.005) { score += 60; motivos.push('valor bate exatamente com o saldo'); }
  else if (difTotal <= 0.005) { score += 50; motivos.push('valor bate com o total do título'); }
  else if (difSaldo <= 0.02) { score += 45; motivos.push('valor bate (diferença de centavos)'); }
  else if (lanc.valor < t.saldo) { score += 8; motivos.push('valor menor que o saldo (pagamento parcial?)'); }
  else { score -= 20; motivos.push('valor maior que o saldo do título'); }

  // 2. DATA — perto do vencimento é bom sinal; muito longe, não.
  const d = diasDe(lanc.data, t.vencimento);
  const ad = Math.abs(d);
  if (ad <= 3) { score += 20; motivos.push('na data do vencimento'); }
  else if (ad <= 10) { score += 14; motivos.push(`${ad} dia(s) do vencimento`); }
  else if (d > 0 && d <= 60) { score += 6; motivos.push(`${d} dias após o vencimento`); }
  else if (d < -30) { score -= 10; motivos.push('muito antes do vencimento'); }

  // 3. NOME — o banco quase sempre escreve quem pagou na descrição.
  const desc = norm(lanc.descricao);
  const fortes = palavrasFortes(t.parte);
  const achou = fortes.filter((p) => desc.includes(p));
  if (achou.length) { score += 25; motivos.push(`descrição cita "${achou[0]}"`); }

  // 4. DOCUMENTO / PEDIDO — quando aparece, é quase certeza.
  const nums = new Set([...numerosDe(lanc.descricao), ...numerosDe(lanc.documento)]);
  const alvo = [t.documento, t.pedidoNumero].filter(Boolean) as string[];
  for (const a of alvo) {
    const an = norm(a);
    if (!an) continue;
    if (desc.includes(an)) { score += 30; motivos.push(`descrição cita ${a}`); break; }
    const dig = numerosDe(a);
    if (dig.length && dig.some((x) => nums.has(x))) { score += 25; motivos.push(`documento ${a} aparece no extrato`); break; }
  }

  return { tituloId: t.id, tipo: t.tipo, score, motivos };
}

/** Sugestões ordenadas da mais provável para a menos. */
export function sugerir(lanc: LancamentoParaConciliar, candidatos: TituloCandidato[], limite = 5): Sugestao[] {
  const lado = lanc.tipo === 'credito' ? 'receber' : 'pagar';
  return candidatos
    .filter((t) => t.tipo === lado && t.saldo > 0)
    .map((t) => pontuar(lanc, t))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.tituloId - b.tituloId)
    .slice(0, limite);
}

/** Pontuação mínima para o sistema agir sozinho. */
export const AUTO_MIN = 80;
/** Folga obrigatória sobre o segundo colocado — sem isso, é empate, e empate não se decide sozinho. */
export const AUTO_FOLGA = 25;

/**
 * O sistema baixa sozinho?
 *
 * Só quando as três coisas valem juntas: pontuação alta, folga sobre o segundo
 * e valor batendo no centavo. Dois títulos do mesmo valor no mesmo dia (acontece
 * o tempo todo: duas parcelas iguais) nunca passam por aqui — e é exatamente
 * esse o caso em que decidir sozinho daria baixa no título errado.
 */
export function decidirAuto(
  lanc: LancamentoParaConciliar,
  sugestoes: Sugestao[],
  candidatos: TituloCandidato[],
): Sugestao | null {
  const top = sugestoes[0];
  if (!top || top.score < AUTO_MIN) return null;
  const segundo = sugestoes[1];
  if (segundo && top.score - segundo.score < AUTO_FOLGA) return null;
  const t = candidatos.find((c) => c.id === top.tituloId && c.tipo === top.tipo);
  if (!t) return null;
  if (Math.abs(lanc.valor - t.saldo) > 0.02) return null;
  return top;
}
