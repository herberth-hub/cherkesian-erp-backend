import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** OP avulsa: produção sem pedido (estoque, amostra, reposição). */
export class CreateOpAvulsaDto {
  @IsInt() produtoId!: number;

  @IsOptional() @IsInt() @Min(1) quantidade?: number;

  /** Grade por tamanho, ex.: {"P":10,"M":20,"G":8}. Se vier, a quantidade é a soma. */
  @IsOptional() @IsObject() gradeTamanhos?: Record<string, number>;

  @IsOptional() @IsInt() filialId?: number;
  @IsOptional() @IsString() @MaxLength(80) cor?: string;
  @IsOptional() @IsIn(['alta', 'media', 'baixa']) prioridade?: string;
  @IsOptional() @IsString() @MaxLength(1000) obs?: string;
}
