/**
 * A CHAVE ANTI-DUPLICATA DE UM LANÇAMENTO.
 *
 * O espelho do banco se sustenta numa unique: (conta, fitid). Puxar a mesma
 * janela de extrato duas vezes tem que ser de graça — se a chave mudar entre
 * uma puxada e outra, o mesmo dinheiro entra duas vezes e o saldo do espelho
 * deixa de valer. É a falha mais cara deste módulo, porque ela não dá erro:
 * só aparece no fechamento, com o número errado.
 *
 * Cada fonte entrega um identificador diferente — ou nenhum:
 *
 *   OFX      FITID, obrigatório no padrão (mas banco brasileiro às vezes omite);
 *   Cora     `id` do lançamento, estável;
 *   Bradesco NADA. O extrato traz `numeroDocumento`, e ele REPETE.
 *
 * Então para o Bradesco a chave tem de ser montada do próprio conteúdo. Isso
 * só funciona sob duas condições, e as duas estão escritas no código:
 *
 *  1. O TEXTO É NORMALIZADO antes de entrar na chave. O banco varia o
 *     espaçamento do histórico entre consultas ("TED   RECEBIDA" x
 *     "TED RECEBIDA"); sem normalizar, o mesmo lançamento gera duas chaves e
 *     duplica.
 *
 *  2. SÓ DIA FECHADO. Dois lançamentos realmente idênticos no mesmo dia
 *     (duas tarifas iguais) são distinguidos pela ORDEM em que o banco os
 *     devolve — o segundo recebe sufixo "-2". Isso é estável enquanto o dia
 *     não se move mais. Num dia ainda em andamento, um lançamento novo pode
 *     entrar no meio e empurrar a numeração, e aí o "-2" de hoje é o "-3" de
 *     amanhã: duplicata. Por isso a janela de importação da API termina em
 *     D-1, nunca em D0.
 *
 * O hash existe só para a chave caber na coluna e não carregar o histórico
 * inteiro; não é segurança, é tamanho.
 */
import { createHash } from 'crypto';

/** O mínimo que um lançamento precisa ter para virar chave. */
export type ParaChave = {
  data: Date;
  valor: number;
  tipo: 'credito' | 'debito';
  descricao: string;
  documento?: string | null;
};

/** Limite da coluna `fitid`. O identificador do banco é cortado aqui também. */
export const MAX_FITID = 120;

/**
 * Texto como ele entra na chave: maiúsculas, espaços colapsados, sem acento.
 *
 * O objetivo é que duas escritas do MESMO histórico caiam na mesma chave. O
 * acento sai porque o mesmo extrato aparece com e sem acentuação dependendo da
 * codificação com que a resposta chega.
 */
export function textoDaChave(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A chave de um lançamento sem identificador do banco.
 *
 * `ocorrencia` distingue repetidos idênticos no mesmo dia, pela ordem do
 * extrato. A primeira ocorrência NÃO leva sufixo, para a chave de um
 * lançamento único nunca depender de quantos vizinhos ele tem.
 */
export function chaveEstavel(l: ParaChave, ocorrencia = 1): string {
  const base = [
    l.data.toISOString().slice(0, 10),
    l.tipo,
    Math.abs(Number(l.valor)).toFixed(2),
    textoDaChave(l.descricao),
    textoDaChave(l.documento),
  ].join('|');
  const h = createHash('sha1').update(base).digest('hex').slice(0, 24);
  return ocorrencia > 1 ? `SEM-ID-${h}-${ocorrencia}` : `SEM-ID-${h}`;
}

/**
 * Põe `fitid` em cada lançamento da janela — o caminho único de toda fonte.
 *
 * `idDoBanco` devolve o identificador do banco quando existe (FITID, `id` do
 * Cora). Quando devolve vazio, a chave é montada do conteúdo.
 *
 * Dois lançamentos com o MESMO identificador do banco na mesma janela não
 * deveriam existir, mas se existirem o segundo não pode sumir: ele também
 * ganha sufixo. Perder um lançamento é tão errado quanto duplicar.
 *
 * A ordem da lista é a ordem do banco, e é ela que numera os repetidos — por
 * isso esta função não ordena nada.
 */
export function chavearLancamentos<T extends ParaChave>(
  lista: T[],
  idDoBanco?: (l: T) => string | null | undefined,
): Array<T & { fitid: string }> {
  const usadas = new Set<string>();
  const vistosPorConteudo = new Map<string, number>();
  const saida: Array<T & { fitid: string }> = [];

  for (const l of lista) {
    const doBanco = String(idDoBanco ? (idDoBanco(l) ?? '') : '').trim().slice(0, MAX_FITID);
    let chave: string;
    if (doBanco) {
      chave = doBanco;
    } else {
      // Quantas vezes este mesmo conteúdo já apareceu nesta janela.
      const semSufixo = chaveEstavel(l, 1);
      const n = (vistosPorConteudo.get(semSufixo) ?? 0) + 1;
      vistosPorConteudo.set(semSufixo, n);
      chave = chaveEstavel(l, n);
    }
    // Rede de segurança: nada sai daqui com chave repetida.
    let unica = chave;
    for (let i = 2; usadas.has(unica); i++) unica = `${chave}#${i}`.slice(0, MAX_FITID);
    usadas.add(unica);
    saida.push({ ...l, fitid: unica });
  }
  return saida;
}
