/**
 * GRADE DO KIT — um kit pode levar VÁRIOS tamanhos.
 *
 * Até aqui o kit era "um tamanho". Quando a OP inteira vai para a MESMA oficina,
 * isso só multiplicava linha na tela, etiqueta para imprimir e bipada para dar:
 * três kits para o mesmo pacote que sai na mesma sacola, para a mesma costureira,
 * na mesma OS. Agora o kit é o PACOTE que vai para uma oficina, e os tamanhos
 * moram na grade.
 *
 * A grade conta PEÇAS por tamanho — a mesma unidade com que a tela de facção, o
 * `disponivelPorTamanho` e o romaneio já falam. `pecasTotal` do kit é a soma dela.
 *
 * Kit antigo (grade vazia) continua funcionando: `gradeDoKit` devolve
 * `{ [tamanho]: pecasTotal }` e todo o resto do sistema não percebe a diferença.
 */

/** Ordem de exibição dos tamanhos (a nomenclatura da casa: PP → G8). */
export const ORDEM_TAMANHOS = [
  'PP', 'P', 'M', 'G', 'GG',
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8',
  'EG', 'EXG', 'EGG', 'EXGG',
  'UNICO', 'ÚNICO', 'U',
] as const;

export type Grade = Record<string, number>;

function posicao(tam: string): number {
  const i = (ORDEM_TAMANHOS as readonly string[]).indexOf(tam);
  // Tamanho fora da tabela (numérico: 36, 38, 40…) vai depois, em ordem natural.
  if (i >= 0) return i;
  const n = Number(tam);
  return Number.isFinite(n) ? 1000 + n : 9000;
}

/** Normaliza uma grade vinda de fora: MAIÚSCULA, inteira, sem zero e sem lixo. */
export function normalizarGrade(valor: unknown): Grade {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const out: Grade = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    const tam = String(k ?? '').trim().toUpperCase();
    if (!tam) continue;
    const q = Math.floor(Number(v));
    if (!Number.isFinite(q) || q <= 0) continue;
    out[tam] = (out[tam] ?? 0) + q;
  }
  return out;
}

/** Tamanhos da grade na ordem da casa. */
export function ordenarTamanhos(tamanhos: string[]): string[] {
  return [...tamanhos].sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b));
}

/** Total de peças da grade. */
export function totalPecas(grade: Grade): number {
  return Object.values(grade).reduce((s, q) => s + (Number(q) || 0), 0);
}

/** Resumo curto p/ a coluna "Tamanho": "M·G·GG". Vazia → "—". */
export function resumoTamanhos(grade: Grade): string {
  const tams = ordenarTamanhos(Object.keys(grade));
  return tams.length ? tams.join('·') : '—';
}

/** Descrição completa p/ etiqueta, OS e histórico: "M 11 · G 6 · GG 3". */
export function descreverGrade(grade: Grade): string {
  return ordenarTamanhos(Object.keys(grade)).map((t) => `${t} ${grade[t]}`).join(' · ');
}

/** Linhas prontas p/ tabela (etiqueta, ficha técnica, tela). */
export function linhasDaGrade(grade: Grade): Array<{ tamanho: string; pecas: number }> {
  return ordenarTamanhos(Object.keys(grade)).map((t) => ({ tamanho: t, pecas: grade[t] }));
}

/**
 * Grade de QUALQUER kit — o unificado tem a sua; o antigo (um tamanho) vira uma
 * grade de uma linha só. É isto que deixa o resto do código tratar os dois iguais.
 */
export function gradeDoKit(kit: { grade?: unknown; tamanho?: string | null; pecasTotal?: number | null }): Grade {
  const g = normalizarGrade(kit?.grade);
  if (Object.keys(g).length) return g;
  const tam = String(kit?.tamanho ?? '').trim().toUpperCase();
  const pecas = Math.max(0, Math.floor(Number(kit?.pecasTotal) || 0));
  if (!tam || !pecas) return {};
  return { [tam]: pecas };
}

/** true quando o kit leva mais de um tamanho. */
export function ehUnificado(kit: { grade?: unknown }): boolean {
  return Object.keys(normalizarGrade(kit?.grade)).length > 1;
}

/** Soma várias grades numa só (unificação). */
export function somarGrades(grades: Grade[]): Grade {
  const out: Grade = {};
  for (const g of grades) for (const [t, q] of Object.entries(g)) out[t] = (out[t] ?? 0) + q;
  return out;
}

/** a − b, nunca negativo; tamanho zerado sai da grade. */
export function subtrairGrade(a: Grade, b: Grade): Grade {
  const out: Grade = {};
  for (const [t, q] of Object.entries(a)) {
    const resto = q - (b[t] ?? 0);
    if (resto > 0) out[t] = resto;
  }
  return out;
}

/**
 * O quanto desta grade dá para tirar do kit, respeitando o que ele tem.
 * Devolve { tirado, falta }: `falta` ≠ vazio quer dizer que o kit não cobre o pedido.
 */
export function tirarDaGrade(doKit: Grade, pedido: Grade): { tirado: Grade; falta: Grade } {
  const tirado: Grade = {};
  const falta: Grade = {};
  for (const [t, q] of Object.entries(pedido)) {
    const tem = doKit[t] ?? 0;
    if (tem >= q) { if (q > 0) tirado[t] = q; }
    else {
      if (tem > 0) tirado[t] = tem;
      falta[t] = q - tem;
    }
  }
  return { tirado, falta };
}

/**
 * Por que estes kits NÃO podem virar um só. Devolve null quando podem.
 *
 * A regra é a da fábrica, não a do banco: só junta o que é o MESMO pacote —
 * mesma OP, mesma cor, mesma operação, mesmo destino, mesmo estágio. Juntar
 * kit que já saiu com kit que não saiu esconderia peça fora de casa.
 */
export type KitParaUnir = {
  id: number;
  codigo: string;
  opId: number | null;
  cor: string | null;
  operacaoFaccao: string | null;
  faccaoNome: string | null;
  controleFaccao: string | null;
  status: string;
  grade?: unknown;
  tamanho?: string | null;
  pecasTotal?: number | null;
  unificadoEmId?: number | null;
};

/** Estágios em que unificar é seguro: o pacote ainda não saiu da casa. */
export const STATUS_UNIFICAVEL = ['criado', 'em_corte', 'aguardando_expedicao'] as const;

const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();

export function motivoNaoUnifica(kits: KitParaUnir[]): string | null {
  if (!Array.isArray(kits) || kits.length < 2) return 'Selecione pelo menos dois kits para unificar.';

  const jaUnificado = kits.find((k) => k.unificadoEmId != null);
  if (jaUnificado) return `O kit ${jaUnificado.codigo} já foi unificado em outro kit.`;

  const forasDoFluxo = kits.filter((k) => !(STATUS_UNIFICAVEL as readonly string[]).includes(k.status));
  if (forasDoFluxo.length) {
    return `Só dá para unificar kit que ainda não saiu para a oficina. ${forasDoFluxo.map((k) => `${k.codigo} (${k.status})`).join(', ')}.`;
  }
  const comControle = kits.filter((k) => (k.controleFaccao ?? '').trim());
  if (comControle.length) {
    return `${comControle.map((k) => k.codigo).join(', ')} já está em uma OS (${comControle[0].controleFaccao}). Unifique antes de mandar para a facção.`;
  }

  const ops = new Set(kits.map((k) => k.opId ?? 0));
  if (ops.size > 1) return 'Os kits são de OPs diferentes — cada OP tem o seu corte e o seu lote.';
  const cores = new Set(kits.map((k) => norm(k.cor)));
  if (cores.size > 1) return `Cores diferentes no mesmo pacote (${[...cores].map((c) => c || '—').join(', ')}). Unifique só o que é da mesma cor.`;
  const opers = new Set(kits.map((k) => norm(k.operacaoFaccao)));
  if (opers.size > 1) return `Operações diferentes (${[...opers].map((o) => o || 'sem operação').join(', ')}). Cada operação é uma OS.`;
  const faccoes = new Set(kits.map((k) => norm(k.faccaoNome)));
  if (faccoes.size > 1) return `Destinos diferentes (${[...faccoes].map((f) => f || 'sem facção').join(', ')}). Unificar só vale quando é tudo para a mesma oficina.`;

  return null;
}

/** Chave de agrupamento: kits com a mesma chave são candidatos a virar um só. */
export function chaveDoPacote(k: KitParaUnir): string {
  return [k.opId ?? 0, norm(k.cor), norm(k.operacaoFaccao), norm(k.faccaoNome), k.status].join('|');
}
