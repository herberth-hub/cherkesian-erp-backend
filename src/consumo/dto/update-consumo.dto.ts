import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** Edição de um item da receita (BOM): quantidade base, unidade e consumo por tamanho. */
export class UpdateConsumoDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'quantidade deve ter no máximo 4 casas decimais.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Informe a unidade (m, kg, un...).' })
  @MaxLength(10)
  unidade?: string;

  /** Consumo por tamanho: { "PP": 1.73, ... }. Enviar {} limpa. */
  @IsOptional() @IsObject() porTamanho?: Record<string, number>;
}
