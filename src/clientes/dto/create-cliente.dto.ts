import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateClienteDto {
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
