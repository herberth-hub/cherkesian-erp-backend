import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ContratoItemDto {
  @IsOptional() @IsInt() produtoId?: number;
  @IsOptional() @IsString() @MaxLength(40) codigo?: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição do item do contrato.' })
  @MaxLength(200)
  descricao!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Preço inválido.' })
  @Min(0)
  preco!: number;

  @IsOptional() @IsString() @MaxLength(10) unidade?: string;
  @IsOptional() @IsString() @MaxLength(200) obs?: string;
}

export class CreateContratoDto {
  @IsInt({ message: 'Selecione o cliente do contrato.' })
  clienteId!: number;

  /** Vendedor dono da carteira (controle de comissão / de quem o cliente pertence). */
  @IsOptional() @IsString() @MaxLength(120) vendedor?: string;

  @IsOptional() @IsString() @MaxLength(60) numero?: string;
  @IsOptional() @IsString() @MaxLength(200) descricao?: string;
  @IsOptional() @IsString() @MaxLength(60) formaPagamento?: string;
  @IsOptional() @IsString() @MaxLength(60) condicaoPagamento?: string;
  @IsOptional() @IsString() @MaxLength(60) prazoEntrega?: string;
  @IsOptional() @IsString() @MaxLength(120) transportadora?: string;
  @IsOptional() @IsString() @MaxLength(30) vigenciaInicio?: string;
  @IsOptional() @IsString() @MaxLength(30) vigenciaFim?: string;
  @IsOptional() @IsString() @MaxLength(2000) observacoes?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContratoItemDto)
  itens?: ContratoItemDto[];
}
