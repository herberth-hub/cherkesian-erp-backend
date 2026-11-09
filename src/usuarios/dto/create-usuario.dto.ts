import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Acesso } from '@prisma/client';
import { SETORES_OP } from '../../common/rbac/setores-op';

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

  /** Obrigatório quando acesso=cliente: vincula o login ao Cliente do portal. */
  @IsOptional()
  @IsInt()
  clienteId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cargo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  setor?: string;

  /**
   * Setores da produção que este usuário pode MOVIMENTAR na OP.
   * Lista vazia (ou ausente) = sem limite, como sempre foi: a trava é opt-in.
   * Precisa estar declarado aqui porque o ValidationPipe global roda com
   * forbidNonWhitelisted — campo não declarado derruba a requisição inteira.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(SETORES_OP as unknown as string[], { each: true, message: 'Setor de produção inválido.' })
  setoresOp?: string[];

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
