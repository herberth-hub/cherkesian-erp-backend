import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class GerarRemessaDto {
  @IsInt() @IsPositive() contaBancariaId!: number;

  /** Títulos a receber que entram na remessa (viram boletos registrados). */
  @IsArray() @ArrayMinSize(1, { message: 'Selecione ao menos um título.' }) @IsInt({ each: true })
  ids!: number[];
}

export class ProcessarRetornoDto {
  @IsInt() @IsPositive() contaBancariaId!: number;

  @IsString() @MaxLength(120) nomeArquivo!: string;

  /** Conteúdo do arquivo .RET (texto, linhas de 240 posições). */
  @IsString() @IsNotEmpty({ message: 'Arquivo de retorno vazio.' })
  conteudo!: string;

  @IsOptional() @IsString() @MaxLength(20) obs?: string;
}
