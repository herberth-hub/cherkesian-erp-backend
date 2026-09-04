import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

/** Unidade/filial dentro do cliente (nome + dados fiscais próprios opcionais). */
export class ClienteUnidadeDto extends ClienteFiscalDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome da unidade.' }) @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) cnpjCpf?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail da unidade inválido.' }) @MaxLength(150) email?: string;
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
  @MaxLength(120)
  grupo?: string;

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

  /** Representante/agente comercial da conta (interno). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  representante?: string;

  /** % de comissão do representante nesta conta (interno). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'comissaoPercent deve ter no máximo 2 casas.' })
  @Min(0) @Max(100)
  comissaoPercent?: number;

  /** Base da comissão do representante: true = com imposto (bruto), false = sem imposto (líquido). */
  @IsOptional()
  @IsBoolean()
  comissaoComImposto?: boolean;

  /** Cliente novo exige peça-piloto antes de liberar produção (regra central). */
  @IsOptional()
  @IsBoolean()
  clienteNovo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;

  /** Unidades/filiais do cliente (substitui a lista inteira ao salvar). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClienteUnidadeDto)
  unidades?: ClienteUnidadeDto[];
}
