import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class EntradaEstoqueDto {
  @IsIn(['materia', 'aviamento', 'produto']) tipo!: string;
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;
  @IsOptional() @IsInt() @IsPositive() materialId?: number;
  @IsOptional() @IsString() @MaxLength(255) descricao?: string;
  @IsOptional() @IsString() @MaxLength(40) ref?: string;
  @IsOptional() @IsString() @MaxLength(40) cor?: string;
  @IsOptional() @IsString() @MaxLength(40) tamanho?: string;
  // Aceita decimal (matéria-prima/aviamento por metro/kg). Produto acabado é
  // arredondado para inteiro no serviço (1 etiqueta por peça, máx. 500).
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantidade deve ter no máximo 3 casas.' })
  @IsPositive({ message: 'quantidade deve ser positiva.' })
  quantidade!: number;
  /** Unidade de medida da entrada (matéria-prima/aviamento): m, kg, un, cone... */
  @IsOptional() @IsString() @MaxLength(10) unidadeMedida?: string;
  @IsOptional() @IsString() @MaxLength(40) loteFornecedor?: string;
  @IsOptional() @IsIn(['estoque', 'expedicao']) destino?: 'estoque' | 'expedicao';
  // A = acabado · B = matéria-prima · C = pilar (só caixa master, sem andar).
  // COM = COMODATO (loja do cliente): não é coluna, é destino — o lugar passa a
  // ser o cliente que está guardando a peça, por isso `comodatoClienteId`.
  @IsOptional() @IsIn(['A', 'B', 'C', 'COM']) coluna?: string;
  @IsOptional() @IsString() @MaxLength(4) andar?: string;
  @IsOptional() @IsString() @MaxLength(10) caixaMaster?: string;
  @IsOptional() @IsInt() @IsPositive() comodatoClienteId?: number;
  @IsOptional() @IsInt() @IsPositive() pedidoId?: number;
  @IsOptional() @IsIn(['entrada', 'producao']) origem?: string;
  /** Etiqueta de lote personalizada (ex.: OP-123) p/ reimpressão por OP. */
  @IsOptional() @IsString() @MaxLength(40) loteEntrada?: string;
}

export class EnderecarDto {
  @IsString() @IsNotEmpty() codigo!: string;
  @IsIn(['A', 'B', 'C', 'COM']) coluna!: string;
  // Andar é obrigatório nas colunas A e B; não existe na coluna C (o pilar, que
  // é só caixa) nem no COMODATO, onde o lugar é o cliente. Quem cobra é o
  // serviço, que sabe qual é a coluna.
  @IsOptional() @IsString() @MaxLength(4) andar?: string;
  // Caixa Master é OPCIONAL em A e B — endereçar só por Coluna + Andar (gôndola
  // aberta/prateleira). Na coluna C ela é OBRIGATÓRIA: é o único endereço que há.
  @IsOptional() @IsString() @MaxLength(10) caixaMaster?: string;
  /** Cliente que vai guardar a peça na loja dele (obrigatório no comodato). */
  @IsOptional() @IsInt() @IsPositive() comodatoClienteId?: number;
  @IsOptional() @IsBoolean() confirmar?: boolean;
}
