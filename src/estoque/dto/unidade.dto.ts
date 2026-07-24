import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

export class EntradaEstoqueDto {
  @IsIn(['materia', 'aviamento', 'produto']) tipo!: string;
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;
  @IsOptional() @IsInt() @IsPositive() materialId?: number;
  @IsOptional() @IsString() @MaxLength(160) descricao?: string;
  @IsOptional() @IsString() @MaxLength(40) cor?: string;
  @IsOptional() @IsString() @MaxLength(10) tamanho?: string;
  @IsInt() @Min(1) @Max(500) quantidade!: number;
  @IsOptional() @IsIn(['estoque', 'expedicao']) destino?: 'estoque' | 'expedicao';
  @IsOptional() @IsIn(['A', 'B']) coluna?: string;
  @IsOptional() @IsInt() @Min(0) @Max(4) andar?: number;
  @IsOptional() @IsString() @MaxLength(10) caixaMaster?: string;
  @IsOptional() @IsInt() @IsPositive() pedidoId?: number;
  @IsOptional() @IsIn(['entrada', 'producao']) origem?: string;
}

export class EnderecarDto {
  @IsString() @IsNotEmpty() codigo!: string;
  @IsIn(['A', 'B']) coluna!: string;
  @IsInt() @Min(0) @Max(4) andar!: number;
  @IsString() @IsNotEmpty() @MaxLength(10) caixaMaster!: string;
}
