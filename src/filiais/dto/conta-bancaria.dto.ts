import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** Campos de integração bancária (CNAB/API) — reusados no create e no update. */
class ContaBancariaIntegracao {
  @IsOptional() @IsString() @MaxLength(5) codigoBanco?: string;
  @IsOptional() @IsIn(['manual', 'cnab', 'api']) integracao?: string;
  @IsOptional() @IsIn(['240', '400']) cnabVersao?: string;
  @IsOptional() @IsString() @MaxLength(4) agenciaDv?: string;
  @IsOptional() @IsString() @MaxLength(4) contaDv?: string;
  @IsOptional() @IsString() @MaxLength(30) convenio?: string;
  @IsOptional() @IsString() @MaxLength(20) codigoTransmissao?: string;
  @IsOptional() @IsString() @MaxLength(10) carteira?: string;
  @IsOptional() @IsString() @MaxLength(10) variacaoCarteira?: string;
  @IsOptional() @IsString() @MaxLength(120) cedenteNome?: string;
  @IsOptional() @IsString() @MaxLength(20) cedenteDocumento?: string;
  @IsOptional() @IsNumber() @Min(0) jurosMensal?: number;
  @IsOptional() @IsNumber() @Min(0) multaPercent?: number;
  @IsOptional() @IsInt() @Min(0) diasBaixaProtesto?: number;
  @IsOptional() @IsString() @MaxLength(1000) instrucaoCaixa?: string;
  @IsOptional() @IsString() @MaxLength(120) apiClientId?: string;
  @IsOptional() @IsIn(['producao', 'homologacao']) apiAmbiente?: string;
}

/** Conta bancária estruturada de uma filial/CNPJ. */
export class ContaBancariaDto extends ContaBancariaIntegracao {
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
export class UpdateContaBancariaDto extends ContaBancariaIntegracao {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) banco?: string;
  @IsOptional() @IsString() @MaxLength(20) agencia?: string;
  @IsOptional() @IsString() @MaxLength(30) conta?: string;
  @IsOptional() @IsIn(['corrente', 'poupanca', 'pagamentos']) tipo?: string;
  @IsOptional() @IsString() @MaxLength(140) pixChave?: string;
  @IsOptional() @IsString() @MaxLength(60) apelido?: string;
  @IsOptional() @IsBoolean() principal?: boolean;
  @IsOptional() @IsBoolean() ativa?: boolean;
}
