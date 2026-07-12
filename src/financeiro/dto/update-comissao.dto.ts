import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';

/** Edição de comissão — todos os campos opcionais. */
export class UpdateComissaoDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendedor?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valorVenda deve ter no máximo 2 casas decimais.' })
  @IsPositive()
  valorVenda?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'percentual deve ter no máximo 4 casas decimais.' })
  @IsPositive()
  @Max(1, { message: 'percentual é uma fração (0 a 1), ex.: 0.05 para 5%.' })
  percentual?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  comissao?: number;

  @IsOptional()
  @IsIn(['A pagar', 'Pago'], { message: 'statusPgto deve ser "A pagar" ou "Pago".' })
  statusPgto?: string;
}
