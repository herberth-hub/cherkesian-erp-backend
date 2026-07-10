/**
 * Utilitários de horário comercial. Comparações feitas em "HH:mm" no fuso da empresa.
 */

/** Retorna o horário atual "HH:mm" no fuso informado (default America/Sao_Paulo). */
export function horaAtual(timeZone = 'America/Sao_Paulo', now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // Alguns ambientes formatam "24:05" à meia-noite; normaliza para "00:05".
  return fmt.format(now).replace(/^24/, '00');
}

/**
 * Verifica se "HH:mm" está dentro da janela [inicio, fim].
 * Se início ou fim forem nulos/vazios, considera SEM restrição (retorna true).
 * Suporta janela que cruza a meia-noite (ex.: 22:00–06:00).
 */
export function dentroDoHorario(
  atual: string,
  inicio?: string | null,
  fim?: string | null,
): boolean {
  if (!inicio || !fim) return true;
  const a = paraMinutos(atual);
  const i = paraMinutos(inicio);
  const f = paraMinutos(fim);
  if (a === null || i === null || f === null) return true;
  if (i <= f) {
    return a >= i && a <= f;
  }
  // janela cruza a meia-noite
  return a >= i || a <= f;
}

function paraMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
