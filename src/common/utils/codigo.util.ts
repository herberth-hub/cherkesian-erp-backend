/**
 * Geração de códigos no padrão do ERP: `PREFIXO-CATEGORIA-0000`
 * (ex.: PRD-CAM-0001, MP-TEC-0003). O sequencial é por prefixo+categoria.
 */

/** Abreviação de categoria: alfanumérico, maiúsculo, 3 primeiros caracteres. */
export function abreviarCategoria(categoria: string): string {
  const limpo = categoria
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (diacríticos combinantes)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return (limpo.slice(0, 3) || 'GEN').padEnd(3, 'X');
}

/**
 * Calcula o próximo código dada a lista de códigos já existentes com o mesmo
 * prefixo+categoria. Preenche buracos pelo maior sequencial encontrado + 1.
 */
export function proximoCodigo(
  prefixo: string,
  categoria: string,
  codigosExistentes: string[],
): string {
  const abrev = abreviarCategoria(categoria);
  const base = `${prefixo}-${abrev}-`;
  let maior = 0;
  for (const cod of codigosExistentes) {
    if (cod.startsWith(base)) {
      const n = Number(cod.slice(base.length));
      if (Number.isInteger(n) && n > maior) maior = n;
    }
  }
  const seq = String(maior + 1).padStart(4, '0');
  return `${base}${seq}`;
}

/**
 * Sequencial simples com prefixo: `PV01`, `OP-0031`, `PIL-0007`, `OC-0012`.
 * `separador` fica entre prefixo e número (ex.: '' para PV, '-' para OP/PIL/OC).
 */
export function proximoSequencial(
  prefixo: string,
  codigosExistentes: string[],
  opts: { pad?: number; separador?: string } = {},
): string {
  const pad = opts.pad ?? 2;
  const sep = opts.separador ?? '';
  const base = `${prefixo}${sep}`;
  let maior = 0;
  for (const cod of codigosExistentes) {
    if (cod.startsWith(base)) {
      const n = Number(cod.slice(base.length));
      if (Number.isInteger(n) && n > maior) maior = n;
    }
  }
  return `${base}${String(maior + 1).padStart(pad, '0')}`;
}
