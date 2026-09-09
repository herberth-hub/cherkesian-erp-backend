import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

/** Um item do lote de OPs avulsas (um produto → uma OP). */
export class OpAvulsaItemDto {
  @IsInt() produtoId!: number;
  @IsOptional() @IsInt() @Min(1) quantidade?: number;
  @IsOptional() @IsObject() gradeTamanhos?: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(80) cor?: string;
}

/**
 * OP avulsa EM LOTE: vários produtos num único lançamento. Cada item vira sua
 * própria OP (o corte/kits/estoque seguem 1 produto por OP), e todas ficam
 * agrupadas pelo mesmo `loteAvulso`. Filial/prioridade/obs são compartilhadas.
 */
export class CreateOpAvulsaLoteDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Adicione ao menos um produto.' })
  @ValidateNested({ each: true })
  @Type(() => OpAvulsaItemDto)
  itens!: OpAvulsaItemDto[];

  @IsOptional() @IsInt() filialId?: number;
  @IsOptional() @IsIn(['alta', 'media', 'baixa']) prioridade?: string;
  @IsOptional() @IsString() @MaxLength(1000) obs?: string;
}
