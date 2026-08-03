import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
