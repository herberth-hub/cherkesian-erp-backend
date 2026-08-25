import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MovimentarEstoqueDto {
  /** Produto acabado (movimenta por tamanho). Informe produtoId OU materialId. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  produtoId?: number;

  /** Matéria-prima / aviamento (movimenta o saldo do material, sem tamanho). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  materialId?: number;

  /** Tamanho/grade da peça (PP, M, G, G4...) — obrigatório só para produto acabado. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tamanho?: string;

  @IsIn(['entrada', 'saida'], { message: "tipo deve ser 'entrada' ou 'saida'." })
  tipo!: 'entrada' | 'saida';

  // Aceita decimal (matéria-prima em kg/m). Produto acabado é arredondado no serviço.
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
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
