import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';

export class CreateContaReceberDto {
  @IsInt()
  @IsPositive()
  clienteId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  pedidoId?: number;

  @IsISO8601({}, { message: 'vencimento deve ser uma data ISO-8601.' })
  @IsNotEmpty()
  vencimento!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'valor deve ser positivo.' })
  valor!: number;
}
