/**
 * QUEM PODE MOVIMENTAR CADA ETAPA DA OP.
 *
 * As áreas (`@Areas`) dizem em que TELA o usuário entra. Isso não basta no chão
 * de fábrica: todo mundo da produção entra na mesma tela, e qualquer um podia
 * empurrar qualquer OP de qualquer etapa — inclusive dar baixa em corte que
 * ninguém cortou, ou finalizar peça que não passou pela costura.
 *
 * Aqui a regra é por SETOR: quem trabalha na costura movimenta o que está na
 * costura. A etapa de ORIGEM é que manda, não a de destino — quem entrega é
 * quem terminou o serviço, e é ele que sabe que terminou.
 *
 * DESLIGADO POR PADRÃO: usuário sem setor nenhum continua movimentando tudo,
 * como sempre fez. A trava só vale para quem o administrador marcar. Assim
 * ninguém fica preso na fábrica no dia do deploy, e a adoção é por pessoa.
 *
 * Vale para TODOS os perfis, inclusive `total`: o líder de produção costuma
 * ter acesso total e é justamente ele que precisa ficar dentro do setor dele.
 * Quem não quer limite para si, não marca setor para si.
 */

/** Setores do fluxo de produção. Valor gravado no usuário — não mudar à toa. */
export const SETORES_OP = ['pcp', 'cad', 'corte', 'separacao', 'estamparia', 'costura', 'acabamento'] as const;
export type SetorOp = (typeof SETORES_OP)[number];

/** Nome bonito, para a tela e para a mensagem de erro. */
export const SETOR_OP_NOME: Record<SetorOp, string> = {
  pcp: 'PCP / Planejamento',
  cad: 'Risco CAD',
  corte: 'Corte',
  separacao: 'Separação',
  estamparia: 'Estamparia / Bordado',
  costura: 'Costura',
  acabamento: 'Acabamento / Finalização',
};

/**
 * Etapa da OP -> setor dono dela.
 * As duas separações são o mesmo setor: é a mesma equipe, antes e depois do
 * bordado. "Finalizado" é do acabamento, que é quem etiqueta a peça pronta.
 */
export const FASE_SETOR: Record<string, SetorOp> = {
  'Risco CAD': 'cad',
  Corte: 'corte',
  'Separação 1': 'separacao',
  'Estamparia/Bordado': 'estamparia',
  'Separação 2': 'separacao',
  Costura: 'costura',
  Acabamento: 'acabamento',
  Finalizado: 'acabamento',
};

/** OP que ainda não entrou em produção: soltar para a primeira etapa é do PCP. */
export const SETOR_ANTES_DE_COMECAR: SetorOp = 'pcp';

/** Só os valores que existem; ignora lixo gravado à mão. */
export function setoresValidos(valores: readonly string[] | null | undefined): SetorOp[] {
  const vistos = new Set<string>();
  return (valores ?? [])
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter((v): v is SetorOp => (SETORES_OP as readonly string[]).includes(v) && !vistos.has(v) && !!vistos.add(v));
}

/** Setor responsável por uma etapa. Etapa vazia/desconhecida = PCP (ainda não começou). */
export function setorDaFase(fase: string | null | undefined): SetorOp {
  const f = String(fase ?? '').trim();
  return FASE_SETOR[f] ?? SETOR_ANTES_DE_COMECAR;
}

/**
 * O usuário pode mexer no que está nesta etapa?
 * Sem setor marcado, pode tudo — a trava é opt-in (ver cabeçalho).
 */
export function podeMoverFase(setoresDoUsuario: readonly string[] | null | undefined, fase: string | null | undefined): boolean {
  const meus = setoresValidos(setoresDoUsuario);
  if (!meus.length) return true;
  return meus.includes(setorDaFase(fase));
}

/** Mensagem que o usuário lê quando a trava pega — diz o que é dele e o que não é. */
export function recadoDeBloqueio(setoresDoUsuario: readonly string[] | null | undefined, fase: string | null | undefined): string {
  const meus = setoresValidos(setoresDoUsuario).map((s) => SETOR_OP_NOME[s]);
  const dona = SETOR_OP_NOME[setorDaFase(fase)];
  const etapa = String(fase ?? '').trim() || 'a iniciar';
  return `"${etapa}" é do setor ${dona} e você responde por ${meus.join(', ')}. Quem está com a peça é quem a entrega — peça ao ${dona} para movimentar.`;
}
