/**
 * O EXTRATO DO CORA, TRADUZIDO.
 *
 * A API devolve (GET /bank-statement/statement):
 *   start: { date, balance }      saldo no início da janela, em CENTAVOS
 *   entries: [{ id, type, amount, createdAt, transaction: { id, type,
 *               description, counterParty: { name, identity } } }]
 *   end:   { date, balance }      saldo no fim da janela, em CENTAVOS
 *
 * Três coisas exigem cuidado e por isso moram aqui, longe da rede, onde dá
 * para testar:
 *
 * 1. VALOR EM CENTAVOS. `amount: 139200` é R$ 1.392,00. Ler como reais
 *    multiplicaria todo o extrato por cem.
 *
 * 2. BLOCK / UNBLOCK não são dinheiro entrando ou saindo — são bloqueio e
 *    desbloqueio de saldo (cautelar, garantia). Entrassem como lançamento,
 *    apareceriam como crédito/débito fantasma para conciliar, e alguém
 *    procuraria a nota fiscal de um bloqueio judicial.
 *
 * 3. QUEM PAGOU. O motor de conciliação acha o título pelo nome na descrição.
 *    No Cora o nome está em `counterParty.name`, separado da descrição — então
 *    os dois são juntados, senão o casamento automático perde o sinal mais
 *    forte que existe depois do valor.
 */
import { ExtratoDoBanco, LancamentoExtrato, centavosParaReais } from './extrato-fonte';

/** Resposta do GET /bank-statement/statement (só o que usamos). */
export interface CoraExtratoResposta {
  start?: { date?: string; balance?: number } | null;
  end?: { date?: string; balance?: number } | null;
  /** Quem é o titular da conta que a credencial abriu. */
  header?: { businessName?: string; businessDocument?: string } | null;
  entries?: Array<{
    id?: string;
    type?: string;
    amount?: number;
    createdAt?: string;
    transaction?: {
      id?: string;
      type?: string;
      description?: string;
      counterParty?: { name?: string; identity?: string } | null;
    } | null;
  }> | null;
}

/** Tipos que mexem dinheiro. BLOCK/UNBLOCK só mudam a disponibilidade. */
const CREDITO = 'CREDIT';
const DEBITO = 'DEBIT';

function dataDe(texto: string | undefined | null): Date | null {
  if (!texto) return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "PIX" + "Pagamento NF 1234" + "SANEPAV" numa linha só, sem repetir. */
export function descricaoCora(e: NonNullable<CoraExtratoResposta['entries']>[number]): string {
  const t = e.transaction ?? {};
  const partes = [t.type, t.description, t.counterParty?.name]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  const vistos = new Set<string>();
  const unicas = partes.filter((p) => {
    const k = p.toUpperCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return unicas.join(' · ') || 'Lançamento sem descrição';
}

/**
 * Traduz a resposta do Cora para o formato do ERP.
 *
 * Lançamento sem `id` é DESCARTADO: sem identificador do banco não há trava
 * anti-duplicata, e um extrato reimportado duplicaria dinheiro na tela. Melhor
 * faltar uma linha (que aparece na conferência de saldo) do que contar a mesma
 * entrada duas vezes.
 */
export function traduzirExtratoCora(resp: CoraExtratoResposta): ExtratoDoBanco {
  const lancamentos: LancamentoExtrato[] = [];
  for (const e of resp.entries ?? []) {
    const tipo = String(e.type ?? '').toUpperCase();
    if (tipo !== CREDITO && tipo !== DEBITO) continue; // BLOCK/UNBLOCK e afins
    const fitid = String(e.id ?? '').trim();
    if (!fitid) continue;
    const data = dataDe(e.createdAt);
    if (!data) continue;
    const valor = centavosParaReais(e.amount);
    if (!(valor > 0)) continue; // lançamento de valor zero não é dinheiro
    lancamentos.push({
      data,
      valor,
      tipo: tipo === CREDITO ? 'credito' : 'debito',
      descricao: descricaoCora(e).slice(0, 300),
      // O documento da contraparte (CNPJ/CPF) ajuda a conciliação a achar o
      // cliente quando o nome vem abreviado no extrato.
      documento: (e.transaction?.counterParty?.identity ?? null) || null,
      fitid,
    });
  }
  const fim = dataDe(resp.end?.date);
  return {
    lancamentos,
    periodoIni: dataDe(resp.start?.date),
    periodoFim: fim,
    // O saldo que vale é o do FIM da janela — é com ele que a tela compara o
    // que o ERP acha que tem.
    saldo: resp.end?.balance != null ? centavosParaReais(resp.end.balance) : null,
    saldoEm: fim,
    // Só os dígitos: o banco manda sem máscara, o cadastro às vezes tem ponto.
    titularDocumento: (resp.header?.businessDocument ?? '').replace(/\D/g, '') || null,
    titularNome: resp.header?.businessName ?? null,
  };
}

/** CNPJ/CPF comparável: só dígitos, sem zero à esquerda sobrando. */
export function soDigitos(doc: string | null | undefined): string {
  return String(doc ?? '').replace(/\D/g, '');
}

/** AAAA-MM-DD, como a API espera. */
export function diaIso(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
