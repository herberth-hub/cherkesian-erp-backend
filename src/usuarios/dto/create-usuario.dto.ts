import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Acesso } from '@prisma/client';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateUsuarioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  usuario!: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter ao menos 6 caracteres.' })
  @MaxLength(200)
  senha!: string;

  @IsEnum(Acesso, { message: 'Perfil de acesso inválido.' })
  acesso!: Acesso;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cargo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  setor?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'horarioInicio deve estar no formato HH:mm.' })
  horarioInicio?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'horarioFim deve estar no formato HH:mm.' })
  horarioFim?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
