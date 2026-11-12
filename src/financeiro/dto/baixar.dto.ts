import { IsBoolean, IsDateString, IsNumber, IsOptional, IsPositive, IsString, Min, MaxLength } from 'class-validator';

/** Baixa (pagamento). Se `valor` omitido, quita o saldo restante do título. */
export class BaixarDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor?: number;

  /** Juros/multa por atraso (somado ao pagamento, além do saldo). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'juros deve ter no máximo 2 casas decimais.' })
  @Min(0)
  juros?: number;

  /** Banco/conta de onde saiu o pagamento (só contas a pagar). */
  @IsOptional() @IsString() @MaxLength(200) banco?: string;

  /**
   * DIA em que o dinheiro saiu/entrou (AAAA-MM-DD). Quase nunca é o dia em que
   * alguém digitou a baixa: o boleto foi pago na sexta e lançado na segunda.
   * Sem esta data o extrato do banco não casa com o título. Omitido = hoje.
   */
  @IsOptional() @IsDateString({}, { message: 'pagoEm deve ser uma data (AAAA-MM-DD).' }) pagoEm?: string;

  /**
   * `valor` veio como o TOTAL pago (boleto de atraso) em vez do principal:
   * o que passar do saldo entra como juros/multa, em vez de ser recusado.
   */
  @IsOptional() @IsBoolean() excedenteComoJuros?: boolean;
}
