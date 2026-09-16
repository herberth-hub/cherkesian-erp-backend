import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PedidoPortalItemDto {
  @IsInt() @IsPositive() produtoId!: number;

  /** Quantidade por tamanho, ex.: { "M": 10, "G": 5 }. Só tamanhos com qtd > 0 contam. */
  @IsOptional() @IsObject() grade?: Record<string, number>;

  /** Quantidade única (produto sem grade de tamanhos). */
  @IsOptional() @IsInt() @IsPositive() quantidade?: number;
}

export class CriarPedidoPortalDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => PedidoPortalItemDto)
  itens!: PedidoPortalItemDto[];

  /** Observação do cliente (centro de custo, filial de entrega, urgência). */
  @IsOptional() @IsString() @MaxLength(1000) observacao?: string;

  /** Chave de idempotência gerada pelo portal (UUID): duplo clique / retry não duplica o pedido. */
  @IsString() @MinLength(8) @MaxLength(80) chaveIdempotencia!: string;
}
