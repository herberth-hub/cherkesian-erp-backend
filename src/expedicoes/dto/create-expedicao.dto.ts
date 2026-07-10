import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateExpedicaoDto {
  @IsInt()
  @IsPositive()
  clienteId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  pedidoId?: number;

  /** Lote consumido na expedição (baixa o estoque). */
  @IsOptional()
  @IsInt()
  @IsPositive()
  loteId?: number;

  @IsInt()
  @Min(1, { message: 'pecas deve ser ao menos 1.' })
  pecas!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  endereco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cidadeUf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  cep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  nf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  transportadora?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  volumes?: number;
}
