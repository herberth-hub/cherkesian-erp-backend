import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/** Cadastro de filial/CNPJ do grupo (emitente de NF-e). */
export class CreateFilialDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da filial.' })
  @MaxLength(120)
  nome!: string;

  @IsOptional() @IsBoolean() matriz?: boolean;
  @IsOptional() @IsBoolean() ativa?: boolean;

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
  @IsOptional() @IsString() @MaxLength(200) focusToken?: string;
}
