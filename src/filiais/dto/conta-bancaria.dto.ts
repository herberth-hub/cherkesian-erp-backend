import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Conta bancária estruturada de uma filial/CNPJ. */
export class ContaBancariaDto {
  @IsString() @MinLength(2) @MaxLength(60) banco!: string;

  @IsOptional() @IsString() @MaxLength(20) agencia?: string;
  @IsOptional() @IsString() @MaxLength(30) conta?: string;

  @IsOptional() @IsIn(['corrente', 'poupanca', 'pagamentos']) tipo?: string;

  @IsOptional() @IsString() @MaxLength(140) pixChave?: string;
  @IsOptional() @IsString() @MaxLength(60) apelido?: string;

  @IsOptional() @IsBoolean() principal?: boolean;
  @IsOptional() @IsBoolean() ativa?: boolean;
}

/** Edição — todos os campos opcionais. */
export class UpdateContaBancariaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) banco?: string;
  @IsOptional() @IsString() @MaxLength(20) agencia?: string;
  @IsOptional() @IsString() @MaxLength(30) conta?: string;
  @IsOptional() @IsIn(['corrente', 'poupanca', 'pagamentos']) tipo?: string;
  @IsOptional() @IsString() @MaxLength(140) pixChave?: string;
  @IsOptional() @IsString() @MaxLength(60) apelido?: string;
  @IsOptional() @IsBoolean() principal?: boolean;
  @IsOptional() @IsBoolean() ativa?: boolean;
}
