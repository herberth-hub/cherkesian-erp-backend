import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Cor do produto. O mockup vai junto, em data URI (o Render não guarda arquivo
 *  em disco entre deploys), por isso o limite é alto como nos outros anexos. */
export class CorProdutoDto {
  @IsString() @MaxLength(60) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) hex?: string;
}

export class AtualizarCorProdutoDto {
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @IsString() @MaxLength(20) hex?: string;
  @IsOptional() @IsInt() @Min(0) ordem?: number;
  /** String vazia apaga o mockup; o campo ausente deixa como está. */
  @IsOptional() @IsString() @MaxLength(12_000_000) mockupFrente?: string;
  @IsOptional() @IsString() @MaxLength(12_000_000) mockupCostas?: string;
}
