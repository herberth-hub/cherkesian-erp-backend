import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Campos fiscais do destinatário (NF-e), reutilizados em create/update. */
export class ClienteFiscalDto {
  @IsOptional() @IsString() @MaxLength(20) inscricaoEstadual?: string;
  @IsOptional() @IsIn([1, 2, 9], { message: 'indicadorIE deve ser 1, 2 ou 9.' }) indicadorIE?: number;
  @IsOptional() @IsString() @MaxLength(150) logradouro?: string;
  @IsOptional() @IsString() @MaxLength(20) numeroEndereco?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsString() @MaxLength(80) municipio?: string;
  @IsOptional() @IsString() @MaxLength(7) codMunicipio?: string;
  @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @IsOptional() @IsString() @MaxLength(9) cep?: string;
}

export class CreateClienteDto extends ClienteFiscalDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do cliente.' })
  @MaxLength(150)
  nome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  fantasia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpjCpf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cidadeUf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  segmento?: string;

  /** Cliente novo exige peça-piloto antes de liberar produção (regra central). */
  @IsOptional()
  @IsBoolean()
  clienteNovo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;
}
