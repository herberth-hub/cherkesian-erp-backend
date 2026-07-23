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

export class CreateNotaEntradaDto {
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;

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

  /** Vencimento do título (se gerarContaPagar). Padrão: hoje. */
  @IsOptional() @IsDateString() vencimento?: string;

  /** Categoria do título a pagar (padrão "Matéria-prima"). */
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
}
