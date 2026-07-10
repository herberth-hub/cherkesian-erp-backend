import {
  IsEnum,
  IsInt,
  IsISO8601,
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
}
