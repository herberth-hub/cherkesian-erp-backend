import { IsNumber, IsOptional, IsPositive, IsString, Min, MaxLength } from 'class-validator';

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
}
