import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** Baixa (pagamento). Se `valor` omitido, quita o saldo restante do título. */
export class BaixarDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor?: number;

  /** Banco/conta de onde saiu o pagamento (só contas a pagar). */
  @IsOptional() @IsString() @MaxLength(120) banco?: string;
}
