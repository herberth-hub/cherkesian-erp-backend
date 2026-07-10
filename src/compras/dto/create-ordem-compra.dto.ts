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

export class CreateOrdemCompraDto {
  @IsInt()
  @IsPositive()
  fornecedorId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  materialId?: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição da compra.' })
  @MaxLength(200)
  descricao!: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas decimais.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a unidade.' })
  @MaxLength(10)
  unidade!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;

  @IsOptional()
  @IsISO8601({}, { message: 'previsao deve ser uma data ISO-8601.' })
  previsao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}
