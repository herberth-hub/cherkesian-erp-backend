import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateComissaoDto {
  @IsInt()
  @IsPositive()
  pedidoId!: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe o vendedor.' })
  @MaxLength(120)
  vendedor!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valorVenda deve ter no máximo 2 casas decimais.' })
  @IsPositive()
  valorVenda!: number;

  /** Fração (ex.: 0.05 = 5%), até 4 casas. */
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'percentual deve ter no máximo 4 casas decimais.' })
  @IsPositive()
  @Max(1, { message: 'percentual é uma fração (0 a 1), ex.: 0.05 para 5%.' })
  percentual!: number;

  /** Opcional: se omitido, calcula valorVenda × percentual. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  comissao?: number;
}
