import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
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
  @IsString()
  @MaxLength(40)
  localizacao?: string;

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

  // ===== Ficha do tecido/artigo (etiqueta do fabricante) =====
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;
  @IsOptional() @IsString() @MaxLength(120) artigo?: string;
  @IsOptional() @IsString() @MaxLength(60) codigoArtigo?: string;
  @IsOptional() @IsString() @MaxLength(200) composicao?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) largura?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) gramatura?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) gramaturaLinear?: number;
}
