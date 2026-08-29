import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ContratoItemDto } from './create-contrato.dto';

export class UpdateContratoDto {
  @IsOptional() @IsInt() clienteId?: number;
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

  /** Se enviado, substitui TODOS os itens do contrato. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContratoItemDto)
  itens?: ContratoItemDto[];
}
