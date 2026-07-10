import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** Um item da receita (BOM): quanto de um material a peça consome. */
export class CreateConsumoDto {
  @IsInt()
  @IsPositive()
  produtoId!: number;

  @IsInt()
  @IsPositive()
  materialId!: number;

  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'quantidade deve ter no máximo 4 casas decimais.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a unidade (m, kg, un...).' })
  @MaxLength(10)
  unidade!: string;
}
