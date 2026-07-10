import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateProdutoDto {
  /** Opcional: se omitido, o sistema gera no padrão PRD-CAT-0000. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  codigo?: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a categoria.' })
  @MaxLength(60)
  categoria!: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a descrição.' })
  @MaxLength(200)
  descricao!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  grade?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'precoBase deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'precoBase deve ser positivo.' })
  precoBase?: number;
}
