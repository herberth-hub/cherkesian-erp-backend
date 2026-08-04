import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateContaReceberDto {
  @IsInt()
  @IsPositive()
  clienteId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  pedidoId?: number;

  /** CNPJ proprietário (HC Quality / Yerevan / Cherkesian). */
  @IsOptional() @IsInt() @IsPositive() filialId?: number;

  /** Nº do documento/NF de origem. */
  @IsOptional() @IsString() @MaxLength(40) documento?: string;

  @IsISO8601({}, { message: 'vencimento deve ser uma data ISO-8601.' })
  @IsNotEmpty()
  vencimento!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;
}
