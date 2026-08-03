import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

/** Conta recorrente (aluguel, luz, água, internet…). Gera um título a pagar por mês. */
export class CreateContaRecorrenteDto {
  @IsString() @IsNotEmpty({ message: 'Informe a categoria.' }) @MaxLength(60) categoria!: string;

  @IsOptional() @IsString() @MaxLength(160) descricao?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;

  @IsInt() @Min(1) @Max(31) diaVencimento!: number;

  @IsOptional() @IsInt() @IsPositive() filialId?: number;
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;
  @IsOptional() @IsBoolean() ativa?: boolean;
}
