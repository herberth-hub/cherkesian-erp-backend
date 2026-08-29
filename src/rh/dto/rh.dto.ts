import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateFuncionarioDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome do funcionário.' }) @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) cpf?: string;
  @IsOptional() @IsString() @MaxLength(80) cargo?: string;
  @IsOptional() @IsString() @MaxLength(80) setor?: string;
  @IsOptional() @IsString() @MaxLength(30) admissao?: string;
  @IsOptional() @IsString() @MaxLength(30) demissao?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salario?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) jornadaDiaria?: number;
  @IsOptional() @IsInt() @Min(1) diasSemana?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valeTransporte?: number;
  @IsOptional() @IsString() @MaxLength(120) banco?: string;
  @IsOptional() @IsString() @MaxLength(140) pixChave?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) obs?: string;
}

export class UpdateFuncionarioDto extends CreateFuncionarioDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) nome!: string;
}

export class PontoItemDto {
  @IsOptional() @IsInt() funcionarioId?: number;
  /** Identificação alternativa quando vem de upload (CSV): casa por CPF ou nome. */
  @IsOptional() @IsString() @MaxLength(20) cpf?: string;
  @IsOptional() @IsString() @MaxLength(160) nome?: string;
  @IsString() @IsNotEmpty({ message: 'Informe a data (AAAA-MM-DD).' }) @MaxLength(30) data!: string;
  @IsOptional() @IsString() @MaxLength(5) entrada?: string;
  @IsOptional() @IsString() @MaxLength(5) saidaAlmoco?: string;
  @IsOptional() @IsString() @MaxLength(5) voltaAlmoco?: string;
  @IsOptional() @IsString() @MaxLength(5) saida?: string;
  @IsOptional() @IsBoolean() falta?: boolean;
  @IsOptional() @IsString() @MaxLength(200) obs?: string;
}

export class PontoBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PontoItemDto)
  registros!: PontoItemDto[];
}

export class FeriasDto {
  @IsInt() funcionarioId!: number;
  @IsString() @IsNotEmpty({ message: 'Informe o início.' }) @MaxLength(30) inicio!: string;
  @IsString() @IsNotEmpty({ message: 'Informe o fim.' }) @MaxLength(30) fim!: string;
  @IsOptional() @IsIn(['ferias', 'abono', 'licenca', 'atestado']) tipo?: string;
  @IsOptional() @IsIn(['agendada', 'gozada']) status?: string;
  @IsOptional() @IsString() @MaxLength(400) obs?: string;
}
