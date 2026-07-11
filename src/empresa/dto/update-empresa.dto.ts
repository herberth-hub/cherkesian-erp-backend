import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

/** Configuração da empresa, incluindo os dados fiscais do emitente da NF-e. */
export class UpdateEmpresaDto {
  @IsOptional() @IsString() @MaxLength(150) nome?: string;
  @IsOptional() @IsString() @MaxLength(60) regime?: string;

  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  @IsOptional() @IsString() @MaxLength(20) inscricaoEstadual?: string;
  @IsOptional() @IsIn([1, 2, 3], { message: 'crt deve ser 1, 2 ou 3.' }) crt?: number;
  @IsOptional() @IsString() @MaxLength(150) nomeFantasia?: string;

  @IsOptional() @IsString() @MaxLength(150) logradouro?: string;
  @IsOptional() @IsString() @MaxLength(20) numeroEndereco?: string;
  @IsOptional() @IsString() @MaxLength(80) complemento?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsString() @MaxLength(80) municipio?: string;
  @IsOptional() @IsString() @MaxLength(7) codMunicipio?: string;
  @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @IsOptional() @IsString() @MaxLength(9) cep?: string;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string;

  @IsOptional() @IsString() @MaxLength(3) nfeSerie?: string;
  @IsOptional() @IsInt() @Min(1, { message: 'nfeProximoNumero deve ser >= 1.' }) nfeProximoNumero?: number;
}
