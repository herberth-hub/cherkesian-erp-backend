import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Uma linha da ordem de compra. */
export class OrdemCompraItemDto {
  @IsOptional() @IsInt() @IsPositive() materialId?: number;
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição do item.' })
  @MaxLength(200)
  descricao!: string;

  @IsOptional() @IsString() @MaxLength(60) codigoFornecedor?: string;
  @IsOptional() @IsString() @MaxLength(200) descricaoFornecedor?: string;
  @IsOptional() @IsObject() grade?: Record<string, number>;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade do item deve ter no máximo 3 casas decimais.' })
  @IsPositive({ message: 'quantidade do item deve ser positiva.' })
  quantidade!: number;

  @IsString() @IsNotEmpty({ message: 'Informe a unidade do item.' }) @MaxLength(10) unidade!: string;

  /**
   * Preço UNITÁRIO, com até 4 casas — é o que permite gravar R$ 1,215 (preço com
   * 10% de desconto no PIX) sem arredondar. O total da linha sai daqui × a
   * quantidade, e o total da ordem é a soma das linhas.
   */
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'valorUnit deve ter no máximo 4 casas decimais.' })
  @IsPositive({ message: 'valorUnit deve ser positivo.' })
  valorUnit!: number;
}

export class CreateOrdemCompraDto {
  @IsInt()
  @IsPositive()
  fornecedorId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  materialId?: number;

  /** Nosso CNPJ comprador (filial emitente da OC). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  filialId?: number;

  /** Produto de revenda comprado pronto (alternativa ao material). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  produtoId?: number;

  /** Compra por tamanho: { "36":10, "38":8, ... }. A quantidade = soma da grade. */
  @IsOptional()
  @IsObject()
  grade?: Record<string, number>;

  /** Código do item no FORNECEDOR (artigo) — para o fornecedor identificar o que comprei. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  codigoFornecedor?: string;

  /** Nome do produto no FORNECEDOR (como ele chama o artigo). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricaoFornecedor?: string;

  /**
   * VÁRIOS ITENS numa ordem só (duas cores do mesmo zíper, dois tecidos do mesmo
   * fornecedor). Com `itens`, a ordem passa a ser o documento e cada linha fica
   * aqui; `descricao`, `quantidade`, `unidade` e `valor` do cabeçalho viram o
   * RESUMO, calculado pelo serviço — não precisam ser enviados.
   *
   * Sem `itens`, nada muda: continua a ordem de item único de sempre.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Informe ao menos 1 item.' })
  @ArrayMaxSize(200, { message: 'No máximo 200 itens por ordem.' })
  @ValidateNested({ each: true })
  @Type(() => OrdemCompraItemDto)
  itens?: OrdemCompraItemDto[];

  @ValidateIf((o: CreateOrdemCompraDto) => !o.itens?.length)
  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição da compra.' })
  @MaxLength(200)
  descricao!: string;

  @ValidateIf((o: CreateOrdemCompraDto) => !o.itens?.length)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas decimais.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @ValidateIf((o: CreateOrdemCompraDto) => !o.itens?.length)
  @IsString()
  @IsNotEmpty({ message: 'Informe a unidade.' })
  @MaxLength(10)
  unidade!: string;

  @ValidateIf((o: CreateOrdemCompraDto) => !o.itens?.length)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;

  @IsOptional()
  @IsISO8601({}, { message: 'previsao deve ser uma data ISO-8601.' })
  previsao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}
