import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMaterialDto {
  /** Opcional: se omitido, o sistema gera no padrão MP-CAT-0000. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  codigo?: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a categoria.' })
  @MaxLength(60)
  categoria!: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição.' })
  @MaxLength(200)
  descricao!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cor?: string;

  /** Unidade de medida (un, m, kg, cone...). */
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
