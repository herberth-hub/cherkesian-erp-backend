import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class ImportarExtratoDto {
  @IsInt() @IsPositive() contaBancariaId!: number;
  @IsOptional() @IsString() @MaxLength(200) nomeArquivo?: string;
  /** Conteúdo do arquivo OFX, como texto. */
  @IsString() @IsNotEmpty() conteudo!: string;
  /** Confirma importar um extrato cujo número de conta não bate com o cadastro. */
  @IsOptional() @IsBoolean() confirmarContaDiferente?: boolean;
  /** `false` só importa, sem casar nada sozinho. */
  @IsOptional() @IsBoolean() conciliarAuto?: boolean;
}

export class ConciliarDto {
  @IsOptional() @IsInt() @IsPositive() contaReceberId?: number;
  @IsOptional() @IsInt() @IsPositive() contaPagarId?: number;
}

export class IgnorarDto {
  @IsOptional() @IsString() @MaxLength(200) motivo?: string;
}
