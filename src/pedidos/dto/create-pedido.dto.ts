import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
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

  /** Grade de tamanhos (qtd por tamanho). Se informada, a quantidade = soma da grade. */
  @IsOptional()
  @IsObject()
  grade?: Record<string, number>;

  /** Cor escolhida do produto (das cores cadastradas). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cor?: string;
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

  /** Unidade/filial do cliente destinatária (opcional). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  clienteUnidadeId?: number;

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

  /** Condição de frete (ex.: "CIF — incluso" / "FOB — por conta do cliente"). */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  frete?: string;

  /** Nº do pedido de compra do cliente (SAP/PO). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ordemCompraCliente?: string;

  /** Pedido de bonificação: sem conta a receber; NF sai como remessa de bonificação. */
  @IsOptional()
  @IsBoolean()
  bonificacao?: boolean;

  /** Observação FISCAL: vai nas informações complementares da NF-e. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;

  /** Observação COMERCIAL: sai na proposta e no pedido; não vai na NF-e. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obsComercial?: string;
}
