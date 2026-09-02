import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Peça-piloto avulsa (amostra sem pedido). */
export class CreatePilotoAvulsoDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome do cliente.' }) @MaxLength(160) clienteNome!: string;
  @IsOptional() @IsInt() clienteId?: number;
  @IsOptional() @IsInt() produtoId?: number;
  @IsOptional() @IsString() @MaxLength(160) modelagem?: string;
  @IsOptional() @IsString() @MaxLength(160) artigo?: string;
  @IsOptional() @IsString() @MaxLength(120) marca?: string;
  @IsOptional() @IsString() @MaxLength(80) cor?: string;
  @IsOptional() @IsString() @MaxLength(80) setor?: string;
  @IsOptional() @IsString() @MaxLength(30) prazoRetorno?: string;
  @IsOptional() @IsString() @MaxLength(1000) obs?: string;
}
