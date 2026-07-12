import { IsDateString, IsNumber, IsOptional, IsPositive } from 'class-validator';

/** Edição de título a receber — vencimento e/ou valor. */
export class UpdateContaReceberDto {
  @IsOptional()
  @IsDateString()
  vencimento?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais.' })
  @IsPositive()
  valor?: number;
}
