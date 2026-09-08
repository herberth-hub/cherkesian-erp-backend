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

  /** NCM do item (8 dígitos) — informado quando não há produto cadastrado. */
  @IsOptional() @IsString() @MaxLength(10) ncm?: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valorUnit deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valorUnit deve ser positivo.' })
  valorUnit!: number;
}

/** Destinatário AVULSO (emitir sem cadastrar o cliente): dados fiscais informados na hora. */
export class DestinatarioAvulsoDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome/razão do destinatário.' }) @MaxLength(150) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) cnpjCpf?: string;
  @IsOptional() @IsString() @MaxLength(20) inscricaoEstadual?: string;
  @IsOptional() @IsInt() indicadorIE?: number; // 1=Contribuinte, 2=Isento, 9=Não contribuinte
  @IsOptional() @IsString() @MaxLength(150) logradouro?: string;
  @IsOptional() @IsString() @MaxLength(20) numeroEndereco?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsString() @MaxLength(80) municipio?: string;
  @IsOptional() @IsString() @MaxLength(7) codMunicipio?: string;
  @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @IsOptional() @IsString() @MaxLength(9) cep?: string;
  @IsOptional() @IsString() @MaxLength(150) email?: string;
}

export class CreateNfeAvulsaDto {
  /** Cliente cadastrado. Opcional se vier `destinatario` avulso. */
  @IsOptional() @IsInt() @IsPositive() clienteId?: number;

  /** Destinatário avulso (emitir sem cadastrar o cliente). */
  @IsOptional() @ValidateNested() @Type(() => DestinatarioAvulsoDto) destinatario?: DestinatarioAvulsoDto;

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

  /** Observações livres → saem em "Informações Adicionais" do DANFE. */
  @IsOptional() @IsString() @MaxLength(2000) observacoes?: string;
}
