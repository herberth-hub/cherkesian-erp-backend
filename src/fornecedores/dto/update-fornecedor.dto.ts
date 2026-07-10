import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFornecedorDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpjCpf?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  obs?: string;
}
