import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PilotoStatus } from '@prisma/client';

export class UpdatePilotoDto {
  @IsOptional()
  @IsEnum(PilotoStatus, { message: 'status de piloto inválido.' })
  status?: PilotoStatus;

  @IsOptional()
  @IsISO8601({}, { message: 'envio deve ser uma data ISO-8601.' })
  envio?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'prazoRetorno deve ser uma data ISO-8601.' })
  prazoRetorno?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  tentativa?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  briefingProduto?: string;

  /** Respostas do briefing (chave = ID do campo, ex.: COM-001). */
  @IsOptional()
  @IsObject()
  briefing?: Record<string, unknown>;
}
