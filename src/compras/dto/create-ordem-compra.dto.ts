import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateOrdemCompraDto {
  @IsInt()
  @IsPositive()
  fornecedorId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  materialId?: number;

  /** Produto de revenda comprado pronto (alternativa ao material). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  produtoId?: number;

  /** Compra por tamanho: { "36":10, "38":8, ... }. A quantidade = soma da grade. */
  @IsOptional()
  @IsObject()
  grade?: Record<string, number>;

  /** Código do item no FORNECEDOR (artigo) — para o fornecedor identificar o que comprei. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  codigoFornecedor?: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição da compra.' })
  @MaxLength(200)
  descricao!: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas decimais.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a unidade.' })
  @MaxLength(10)
  unidade!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;

  @IsOptional()
  @IsISO8601({}, { message: 'previsao deve ser uma data ISO-8601.' })
  previsao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}
