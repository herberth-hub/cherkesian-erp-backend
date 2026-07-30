import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ComponenteDto, ProdutoFichaDto } from './create-produto.dto';

export class UpdateProdutoDto extends ProdutoFichaDto {
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
  @MaxLength(300)
  cor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  grade?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'precoBase deve ter no máximo 2 casas decimais.' })
  @IsPositive({ message: 'precoBase deve ser positivo.' })
  precoBase?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'custo deve ter no máximo 2 casas decimais.' })
  @Min(0)
  custo?: number;

  @IsOptional() @IsIn(['producao', 'revenda']) tipo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'precoEspecial deve ter no máximo 2 casas.' })
  @Min(0)
  precoEspecial?: number;

  @IsOptional() @IsString() @MaxLength(120) tamsEspeciais?: string;
  @IsOptional() @IsString() @MaxLength(120) clienteGrupo?: string;
  @IsOptional() @IsInt() @IsPositive() clienteId?: number;
  @IsOptional() @IsString() @MaxLength(80) setor?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponenteDto)
  componentes?: ComponenteDto[];
}
