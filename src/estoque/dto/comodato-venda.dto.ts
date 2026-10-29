import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsObject, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

/** Prévia: quanto sairia de cobrança por estas etiquetas (não escreve nada). */
export class ComodatoPreviaDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) codigos!: string[];
  /** Preço por produtoId informado na hora (quando contrato e tabela não cobrem). */
  @IsOptional() @IsObject() precos?: Record<string, number>;
}

/** O cliente vendeu: baixa as peças, cria o pedido e lança o título. */
export class ComodatoVendaDto extends ComodatoPreviaDto {
  /** Data do vencimento (YYYY-MM-DD). Sem ela, vale o prazo da forma de pagamento. */
  @IsOptional() @IsString() @MaxLength(25) vencimento?: string;
  @IsOptional() @IsString() @MaxLength(80) formaPagamento?: string;
  @IsOptional() @IsInt() @Min(1) @Max(12) parcelas?: number;
  @IsOptional() @IsIn(['boleto', 'transferencia']) cobrar?: 'boleto' | 'transferencia';
  /** CNPJ emissor; sem ele vale o do contrato e, por fim, a matriz. */
  @IsOptional() @IsInt() @IsPositive() filialId?: number;
  @IsOptional() @IsString() @MaxLength(255) obs?: string;
}
