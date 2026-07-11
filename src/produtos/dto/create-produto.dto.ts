import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Campos fiscais reutilizados por create/update de produto (NF-e). */
export class ProdutoFiscalDto {
  @IsOptional() @IsString() @MaxLength(8) ncm?: string;
  @IsOptional() @IsString() @MaxLength(4) cfop?: string;
  @IsOptional() @IsInt() @Min(0) @Max(8) origem?: number;
  @IsOptional() @IsString() @MaxLength(6) unidadeComercial?: string;
  @IsOptional() @IsString() @MaxLength(7) cest?: string;
  @IsOptional() @IsString() @MaxLength(4) icmsCst?: string;
  @IsOptional() @IsString() @MaxLength(2) pisCst?: string;
  @IsOptional() @IsString() @MaxLength(2) cofinsCst?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'icmsAliquota deve ter no máximo 2 casas.' })
  @Min(0)
  @Max(100)
  icmsAliquota?: number;
}

export class CreateProdutoDto extends ProdutoFiscalDto {
  /** Opcional: se omitido, o sistema gera no padrão PRD-CAT-0000. */
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

  @IsOptional()
  @IsString()
  @MaxLength(60)
  grade?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'precoBase deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'precoBase deve ser positivo.' })
  precoBase?: number;
}
