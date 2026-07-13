import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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

/** Uma linha da tabela de medidas (grade) da ficha técnica. */
export class FichaMedidaDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição da medida.' })
  @MaxLength(80)
  descricao!: string;

  @IsOptional() @IsString() @MaxLength(20) tolerancia?: string;

  /** Valores por tamanho: { "PP": "43", "P": "47", ... } (strings livres). */
  @IsOptional() @IsObject() valores?: Record<string, string>;

  @IsOptional() @IsInt() @Min(0) ordem?: number;
}

/** Campos descritivos da ficha técnica (herda os fiscais). */
export class ProdutoFichaDto extends ProdutoFiscalDto {
  @IsOptional() @IsString() @MaxLength(60) referencia?: string;
  @IsOptional() @IsString() @MaxLength(80) marca?: string;
  @IsOptional() @IsString() @MaxLength(60) linha?: string;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string;
  @IsOptional() @IsString() @MaxLength(80) modelagem?: string;
  @IsOptional() @IsString() @MaxLength(120) tecido?: string;
  @IsOptional() @IsString() @MaxLength(160) composicao?: string;
  @IsOptional() @IsString() @MaxLength(6000) especificacoes?: string;
  @IsOptional() @IsString() @MaxLength(4000) observacoes?: string;
  // Fotos em data URI base64 (comprimidas no cliente). Limite alto p/ imagens.
  @IsOptional() @IsString() @MaxLength(4_000_000) fotoModelo?: string;
  @IsOptional() @IsString() @MaxLength(4_000_000) fotoModelagem?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FichaMedidaDto)
  medidas?: FichaMedidaDto[];
}

export class CreateProdutoDto extends ProdutoFichaDto {
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
