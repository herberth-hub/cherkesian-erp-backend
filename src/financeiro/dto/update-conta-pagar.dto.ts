import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** Edição de título a pagar — categoria, referência, fornecedor, vencimento e/ou valor. */
export class UpdateContaPagarDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referencia?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  fornecedorId?: number;

  @IsOptional()
  @IsDateString()
  vencimento?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive()
  valor?: number;
}
