import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateMaterialDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unidade?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'saldo deve ter no máximo 3 casas decimais.' })
  @Min(0, { message: 'saldo não pode ser negativo.' })
  saldo?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'minimo deve ter no máximo 3 casas decimais.' })
  @Min(0, { message: 'minimo não pode ser negativo.' })
  minimo?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'custo deve ter no máximo 2 casas decimais.' })
  @Min(0, { message: 'custo não pode ser negativo.' })
  custo?: number;
}
