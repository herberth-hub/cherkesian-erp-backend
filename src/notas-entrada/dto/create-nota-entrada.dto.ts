import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

export class NotaEntradaItemDto {
  @IsOptional() @IsInt() @IsPositive() materialId?: number;
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição do item.' })
  @MaxLength(200)
  descricao!: string;

  @IsOptional() @IsString() @MaxLength(8) ncm?: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @IsOptional() @IsString() @MaxLength(10) unidade?: string;

  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'valorUnit deve ter no máximo 4 casas.' })
  @Min(0)
  valorUnit!: number;
}

export class ParcelaEntradaDto {
  @IsDateString() vencimento!: string;
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor da parcela deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valor da parcela deve ser positivo.' })
  valor!: number;
}

export class CreateNotaEntradaDto {
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;

  /** CNPJ destinatário (filial HC Quality / Cherkesian) que recebeu a mercadoria. */
  @IsOptional() @IsInt() @IsPositive() filialId?: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe o número da NF.' })
  @MaxLength(40)
  numero!: string;

  @IsOptional() @IsString() @MaxLength(10) serie?: string;
  @IsOptional() @IsString() @MaxLength(44) chave?: string;
  @IsOptional() @IsString() @MaxLength(20) cnpjEmitente?: string;
  @IsOptional() @IsString() @MaxLength(150) nomeEmitente?: string;
  @IsOptional() @IsDateString() emitidaEm?: string;
  @IsOptional() @IsString() @MaxLength(500) obs?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A nota precisa de ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => NotaEntradaItemDto)
  itens!: NotaEntradaItemDto[];

  /** Soma as quantidades ao saldo das matérias-primas vinculadas (materialId). */
  @IsOptional() @IsBoolean() lancarEstoque?: boolean;

  /** Gera o título no Contas a Pagar. */
  @IsOptional() @IsBoolean() gerarContaPagar?: boolean;

  /** Vencimento do título (se gerarContaPagar e sem parcelas). Padrão: hoje. */
  @IsOptional() @IsDateString() vencimento?: string;

  /** Parcelas do título a pagar (uma conta por parcela). Se vazio, gera 1 título. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParcelaEntradaDto)
  parcelas?: ParcelaEntradaDto[];

  /** Categoria do título a pagar (padrão "Matéria-prima"). */
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
}
