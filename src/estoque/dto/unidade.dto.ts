import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

export class EntradaEstoqueDto {
  @IsIn(['materia', 'aviamento', 'produto']) tipo!: string;
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;
  @IsOptional() @IsInt() @IsPositive() materialId?: number;
  @IsOptional() @IsString() @MaxLength(160) descricao?: string;
  @IsOptional() @IsString() @MaxLength(40) ref?: string;
  @IsOptional() @IsString() @MaxLength(40) cor?: string;
  @IsOptional() @IsString() @MaxLength(40) tamanho?: string;
  @IsInt() @Min(1) @Max(500) quantidade!: number;
  @IsOptional() @IsString() @MaxLength(40) loteFornecedor?: string;
  @IsOptional() @IsIn(['estoque', 'expedicao']) destino?: 'estoque' | 'expedicao';
  @IsOptional() @IsIn(['A', 'B']) coluna?: string;
  @IsOptional() @IsString() @MaxLength(4) andar?: string;
  @IsOptional() @IsString() @MaxLength(10) caixaMaster?: string;
  @IsOptional() @IsInt() @IsPositive() pedidoId?: number;
  @IsOptional() @IsIn(['entrada', 'producao']) origem?: string;
  /** Etiqueta de lote personalizada (ex.: OP-123) p/ reimpressão por OP. */
  @IsOptional() @IsString() @MaxLength(40) loteEntrada?: string;
}

export class EnderecarDto {
  @IsString() @IsNotEmpty() codigo!: string;
  @IsIn(['A', 'B']) coluna!: string;
  @IsString() @IsNotEmpty() @MaxLength(4) andar!: string;
  @IsString() @IsNotEmpty() @MaxLength(10) caixaMaster!: string;
  @IsOptional() @IsBoolean() confirmar?: boolean;
}
