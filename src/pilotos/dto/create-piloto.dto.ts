import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePilotoDto {
  @IsInt()
  @IsPositive()
  pedidoId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  produtoId?: number;

  /** Prazo de retorno da avaliação do cliente (ISO-8601). */
  @IsOptional()
  @IsISO8601({}, { message: 'prazoRetorno deve ser uma data ISO-8601.' })
  prazoRetorno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;
}
