import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsPositive, ValidateNested } from 'class-validator';

export class ParcelaDto {
  @IsDateString() vencimento!: string;
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor da parcela deve ter no máximo 2 casas.' })
  @IsPositive({ message: 'valor da parcela deve ser positivo.' })
  valor!: number;
}

export class ParcelarDto {
  @IsArray()
  @ArrayMinSize(2, { message: 'Informe ao menos 2 parcelas.' })
  @ValidateNested({ each: true })
  @Type(() => ParcelaDto)
  parcelas!: ParcelaDto[];
}
