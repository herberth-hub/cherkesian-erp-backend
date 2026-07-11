import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateMedidaDto {
  @IsInt()
  @IsPositive()
  clienteId!: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe o colaborador.' })
  @MaxLength(150)
  colaborador!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cargo?: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe o tamanho (PP, P, M, G...).' })
  @MaxLength(10)
  tamanho!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  torax?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  cintura?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quadril?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  altura?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  obs?: string;
}
