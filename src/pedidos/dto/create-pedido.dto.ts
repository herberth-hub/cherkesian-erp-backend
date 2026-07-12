import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePedidoItemDto {
  /** Produto do catálogo (opcional para itens avulsos). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  produtoId?: number;

  /** Se omitido e houver produtoId, usa a descrição do produto. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricao?: string;

  @IsInt()
  @Min(1, { message: 'quantidade deve ser ao menos 1.' })
  quantidade!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valorUnit deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valorUnit deve ser positivo.' })
  valorUnit!: number;
}

export class CreatePedidoDto {
  @IsInt()
  @IsPositive()
  clienteId!: number;

  /** CNPJ emissor (matriz/filial). Se omitido, usa a matriz. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  filialId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'O pedido precisa de pelo menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => CreatePedidoItemDto)
  itens!: CreatePedidoItemDto[];

  /** Prazo combinado de entrega ao cliente (aparece no radar do dashboard). */
  @IsOptional()
  @IsDateString()
  prazoEntrega?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  formaPagamento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;
}
