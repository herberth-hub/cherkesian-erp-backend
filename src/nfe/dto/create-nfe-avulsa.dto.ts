import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class NfeAvulsaItemDto {
  /** Produto do catálogo (traz descrição e dados fiscais). Opcional para item avulso. */
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;

  @IsOptional() @IsString() @MaxLength(200) descricao?: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valorUnit deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valorUnit deve ser positivo.' })
  valorUnit!: number;
}

export class CreateNfeAvulsaDto {
  @IsInt() @IsPositive() clienteId!: number;

  /** CNPJ emissor (matriz/filial). Se omitido, usa a matriz. */
  @IsOptional() @IsInt() @IsPositive() filialId?: number;

  /** Pedido de venda vinculado — ao emitir, avança o pedido para aprovado. */
  @IsOptional() @IsInt() @IsPositive() pedidoId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'A nota precisa de ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => NfeAvulsaItemDto)
  itens!: NfeAvulsaItemDto[];

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) naturezaOperacao?: string;

  /** Nº do pedido de compra do cliente (SAP/PO) — vai nos dados adicionais da NF. */
  @IsOptional() @IsString() @MaxLength(60) ordemCompraCliente?: string;

  /** Quantidade de volumes declarada na NF (transporte). Padrão: nº de peças. */
  @IsOptional() @IsInt() @IsPositive() volumes?: number;

  /** Prazo de pagamento em dias a partir do faturamento (gera fatura/duplicata na NF). */
  @IsOptional() @IsInt() @IsPositive() diasVencimento?: number;
}
