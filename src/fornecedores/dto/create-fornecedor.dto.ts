import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFornecedorDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do fornecedor.' })
  @MaxLength(150)
  nome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nomeFantasia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpjCpf?: string;

  /** Ex.: "Tecido", "Aviamento", "Facção". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tipo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cidadeUf?: string;

  /** Chave PIX p/ pagamento (CPF/CNPJ, e-mail, celular ou aleatória). */
  @IsOptional()
  @IsString()
  @MaxLength(140)
  chavePix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;

  // ===== Dados fiscais (p/ NF-e de remessa para industrialização) =====
  @IsOptional() @IsBoolean() faccao?: boolean;
  @IsOptional() @IsString() @MaxLength(20) inscricaoEstadual?: string;
  @IsOptional() @IsInt() indicadorIE?: number;
  @IsOptional() @IsString() @MaxLength(120) logradouro?: string;
  @IsOptional() @IsString() @MaxLength(20) numeroEndereco?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsString() @MaxLength(80) municipio?: string;
  @IsOptional() @IsString() @MaxLength(7) codMunicipio?: string;
  @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @IsOptional() @IsString() @MaxLength(9) cep?: string;
}
