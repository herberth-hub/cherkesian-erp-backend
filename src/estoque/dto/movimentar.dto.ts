import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MovimentarEstoqueDto {
  @IsInt()
  @IsPositive()
  produtoId!: number;

  /** Tamanho/grade da peça (PP, M, G, G4...). */
  @IsString()
  @IsNotEmpty({ message: 'Informe o tamanho.' })
  @MaxLength(20)
  tamanho!: string;

  @IsIn(['entrada', 'saida'], { message: "tipo deve ser 'entrada' ou 'saida'." })
  tipo!: 'entrada' | 'saida';

  @IsInt()
  @Min(1, { message: 'quantidade deve ser ao menos 1.' })
  quantidade!: number;

  /** Só para ENTRADA: código do lote (gerado automaticamente se omitido). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  codigoLote?: string;

  /** Só para ENTRADA: OP que originou a produção (rastreabilidade). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  opId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  localizacao?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  minimo?: number;
}
