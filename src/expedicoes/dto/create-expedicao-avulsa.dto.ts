import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
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

/**
 * Motivos de uma saída SEM pedido de venda. Lista fechada porque é isso que
 * explica, depois, por que a mercadoria saiu sem faturar — em campo livre vira
 * "amostra", "Amostra", "amostras" e o relatório não fecha.
 */
export const MOTIVOS_AVULSA = [
  'AMOSTRA',
  'PEÇA PILOTO',
  'REPOSIÇÃO / GARANTIA',
  'BONIFICAÇÃO / BRINDE',
  'ENVIO PARA FACÇÃO',
  'TRANSFERÊNCIA ENTRE UNIDADES',
  'EMPRÉSTIMO / MOSTRUÁRIO',
  'OUTRO',
] as const;

export class ExpedicaoAvulsaItemDto {
  /** Produto do catálogo. Sem ele, use `descricao` (item solto). */
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;

  @IsOptional() @IsString() @MaxLength(200) descricao?: string;

  @IsOptional() @IsString() @MaxLength(80) cor?: string;

  @IsInt() @Min(1, { message: 'A quantidade do item deve ser ao menos 1.' })
  quantidade!: number;

  /** Grade de tamanhos { "M": 3, "G": 2 }. Se vier, a quantidade é a soma. */
  @IsOptional() @IsObject() grade?: Record<string, number>;

  /** Só para conferência/romaneio — expedição avulsa não fatura. */
  @IsOptional() @IsNumber() @Min(0) valorUnit?: number;
}

/** Expedição SEM pedido e SEM nota fiscal: amostra, piloto, reposição, facção. */
export class CreateExpedicaoAvulsaDto {
  @IsInt() @IsPositive() clienteId!: number;

  @IsIn(MOTIVOS_AVULSA as unknown as string[], { message: 'Escolha um motivo da lista.' })
  motivo!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A expedição precisa de pelo menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => ExpedicaoAvulsaItemDto)
  itens!: ExpedicaoAvulsaItemDto[];

  /** Unidade do cliente destinatária (usa o endereço dela). */
  @IsOptional() @IsInt() @IsPositive() clienteUnidadeId?: number;

  @IsOptional() @IsString() @MaxLength(200) endereco?: string;
  @IsOptional() @IsString() @MaxLength(80) cidadeUf?: string;
  @IsOptional() @IsString() @MaxLength(12) cep?: string;
  @IsOptional() @IsInt() @Min(1) volumes?: number;

  /** Observação livre — vai no romaneio. */
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}
