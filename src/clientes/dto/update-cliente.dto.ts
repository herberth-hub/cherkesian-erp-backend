import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClienteFiscalDto, ClienteUnidadeDto } from './create-cliente.dto';

export class UpdateClienteDto extends ClienteFiscalDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nome?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(150)
  representante?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'comissaoPercent deve ter no máximo 2 casas.' })
  @Min(0) @Max(100)
  comissaoPercent?: number;

  @IsOptional()
  @IsBoolean()
  comissaoComImposto?: boolean;

  @IsOptional()
  @IsBoolean()
  clienteNovo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClienteUnidadeDto)
  unidades?: ClienteUnidadeDto[];
}
