/**
 * DE ONDE VEM O EXTRATO.
 *
 * O arquivo OFX e a API do banco são a mesma coisa vista de dois lugares: uma
 * lista de lançamentos e um saldo declarado pelo banco. O que muda é só como a
 * lista chega. Por isso as duas fontes param aqui, no mesmo formato, e dali
 * para a frente o caminho é um só — dedup pelo id do banco, gravação e
 * conciliação.
 *
 * Trocar OFX por API não pode mudar o que a tela mostra nem como a baixa é
 * decidida. Se mudasse, teríamos dois financeiros.
 */

/** Um lançamento já no formato do ERP. */
export interface LancamentoExtrato {
  data: Date;
  /** Sempre POSITIVO — o sinal está em `tipo`. */
  valor: number;
  tipo: 'credito' | 'debito';
  descricao: string;
  documento?: string | null;
  /**
   * Identificador do lançamento NO BANCO. É a trava anti-duplicata: a mesma
   * janela importada duas vezes não duplica dinheiro na tela.
   */
  fitid: string;
}

/** O que uma fonte devolve: a janela pedida, já traduzida. */
export interface ExtratoDoBanco {
  lancamentos: LancamentoExtrato[];
  periodoIni?: Date | null;
  periodoFim?: Date | null;
  /** Saldo que o BANCO declara — é contra ele que o espelho é conferido. */
  saldo?: number | null;
  saldoEm?: Date | null;
  /**
   * CNPJ do TITULAR da conta, como o banco informa.
   *
   * É a mesma conferência que o OFX já fazia com o número da conta, e aqui ela
   * é mais necessária: uma credencial de API atende UMA conta, mas a tela
   * oferece todas. Sem comparar o titular, puxar o extrato com a conta errada
   * selecionada arquivaria o dinheiro de um CNPJ debaixo de outro, em silêncio.
   */
  titularDocumento?: string | null;
  titularNome?: string | null;
}

/** Uma fonte automática (API de banco). */
export interface FonteExtratoApi {
  /** Nome para log e mensagem de erro ("Cora"). */
  readonly nome: string;
  buscar(de: Date, ate: Date): Promise<ExtratoDoBanco>;
  saldo(): Promise<number | null>;
}

/** Centavos inteiros (como os bancos mandam) para reais. */
export function centavosParaReais(centavos: number | string | null | undefined): number {
  const n = Number(centavos ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}
