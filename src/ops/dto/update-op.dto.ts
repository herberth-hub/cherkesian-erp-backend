import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OPStatus } from '@prisma/client';

export class UpdateOpStatusDto {
  @IsEnum(OPStatus, { message: 'status de OP inválido.' })
  status!: OPStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  setorAtual?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  responsavel?: string;
}

export class UpdateOpProgressoDto {
  @IsInt()
  @Min(0, { message: 'progresso mínimo é 0.' })
  @Max(100, { message: 'progresso máximo é 100.' })
  progresso!: number;
}

export class UpdateOpGradeDto {
  /** Distribuição por tamanho, ex.: {"P":10,"M":20,"G":8}. {} limpa a grade. */
  @IsObject({ message: 'grade deve ser um objeto {tamanho: quantidade}.' })
  grade!: Record<string, number>;
}
