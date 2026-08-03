import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

/** Conta recorrente (aluguel, luz, água, internet, salário, VT/VR…). Gera um título a pagar por mês. */
export class CreateContaRecorrenteDto {
  @IsString() @IsNotEmpty({ message: 'Informe a categoria.' }) @MaxLength(60) categoria!: string;

  @IsOptional() @IsString() @MaxLength(160) descricao?: string;

  /** fixo (valor mensal) | dia_util (valorDia × dias úteis do mês, p/ VT e VR). */
  @IsOptional() @IsIn(['fixo', 'dia_util']) tipoCalculo?: string;

  /** Valor mensal (modo fixo). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor?: number;

  /** Valor por dia útil (modo dia_util). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valorDia deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valorDia deve ser positivo.' })
  valorDia?: number;

  @IsInt() @Min(1) @Max(31) diaVencimento!: number;

  @IsOptional() @IsInt() @IsPositive() filialId?: number;
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;
  @IsOptional() @IsBoolean() ativa?: boolean;
}
