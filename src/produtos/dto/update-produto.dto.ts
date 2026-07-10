import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateProdutoDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descricao?: string;

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
