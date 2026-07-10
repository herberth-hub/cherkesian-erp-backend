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

export class CreateContaPagarDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  fornecedorId?: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a categoria (ex.: Matéria-prima, Facção, Aluguel).' })
  @MaxLength(80)
  categoria!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referencia?: string;

  @IsISO8601({}, { message: 'vencimento deve ser uma data ISO-8601.' })
  @IsNotEmpty()
  vencimento!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;
}
