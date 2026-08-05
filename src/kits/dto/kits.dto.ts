import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

/** Cadastro do lote de tecido recebido do fornecedor. */
export class CreateLoteDto {
  @IsString() @IsNotEmpty({ message: 'Informe o código do lote.' }) @MaxLength(40) codigoLote!: string;
  @IsOptional() @IsInt() @IsPositive() materialId?: number;
  @IsOptional() @IsString() @MaxLength(40) codigoTecido?: string;
  @IsOptional() @IsString() @MaxLength(160) descricaoTecido?: string;
  @IsOptional() @IsString() @MaxLength(40) corTecido?: string;
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;
  @IsOptional() @IsString() @MaxLength(120) fornecedorNome?: string;
  @IsOptional() @IsString() @MaxLength(40) nfCompra?: string;
  @IsOptional() @IsString() dataRecebimento?: string;
}

/** Gera os kits (um por tamanho) a partir da grade de uma OP. */
export class CriarKitsDeOpDto {
  @IsInt() @IsPositive() opId!: number;
  /** Lote do tecido usado no enfesto (opcional — pode ser vinculado depois). */
  @IsOptional() @IsInt() @IsPositive() loteTecidoId?: number;
  @IsOptional() @IsString() @MaxLength(120) faccaoNome?: string;
  @IsOptional() @IsInt() @IsPositive() faccaoId?: number;
  @IsOptional() @IsString() @MaxLength(30) enfesto?: string;
  @IsOptional() @IsString() @MaxLength(30) ordemCorte?: string;
  @IsOptional() @IsString() @MaxLength(30) mesaCorte?: string;
  @IsOptional() @IsString() @MaxLength(80) operadorCorte?: string;
  @IsOptional() @IsString() @MaxLength(40) cor?: string;
  @IsOptional() @IsString() @MaxLength(20) caixa?: string;
  /** Peças por jogo (componentes). Total de peças do kit = jogos × isto. Padrão 1. */
  @IsOptional() @IsInt() @Min(1) pecasPorJogo?: number;
}

/** Expedição do kit para a facção (leitura do QR/código). */
export class ExpedirKitDto {
  @IsString() @IsNotEmpty() codigo!: string;
  @IsOptional() @IsString() @MaxLength(120) faccaoNome?: string;
  @IsOptional() @IsString() @MaxLength(120) transportador?: string;
  /** Nº da NF de remessa para industrialização (facção). */
  @IsOptional() @IsString() @MaxLength(40) remessaNf?: string;
  @IsOptional() @IsString() @MaxLength(300) obs?: string;
}

/** Retorno do kit da facção — exige a NF de retorno (trava a entrada). */
export class RetornarKitDto {
  @IsString() @IsNotEmpty() codigo!: string;
  /** Nº da NF de retorno da facção — obrigatório para dar entrada. */
  @IsString() @IsNotEmpty({ message: 'Informe a NF de retorno da facção para dar entrada no kit.' }) @MaxLength(40) retornoNf!: string;
  @IsOptional() @IsInt() @Min(0) qtd?: number;
  @IsOptional() @IsString() @MaxLength(300) obs?: string;
  // ===== Conferência de faltas / anomalia no retorno =====
  /** Quantidade de peças faltando ou com anomalia (0 = veio tudo certo). */
  @IsOptional() @IsInt() @Min(0) qtdFaltas?: number;
  /** true = gerar OC de reposição automática; false = NÃO repor (exige senha do PCP). */
  @IsOptional() @IsBoolean() repor?: boolean;
  /** Fornecedor/facção da OC de reposição (default: facção do kit). */
  @IsOptional() @IsInt() @IsPositive() fornecedorId?: number;
  /** Valor unitário estimado da peça (para a OC de reposição). */
  @IsOptional() @IsNumber() @Min(0) valorUnit?: number;
  /** Senha do PCP — obrigatória quando há faltas e o responsável opta por NÃO repor. */
  @IsOptional() @IsString() senhaPcp?: string;
}

/** Atribui uma caixa de armazenamento a um conjunto de kits. */
export class AtribuirCaixaDto {
  @IsString() @IsNotEmpty({ message: 'Informe o código da caixa.' }) @MaxLength(20) caixa!: string;
  @IsArray() @ArrayMinSize(1, { message: 'Selecione ao menos um kit.' }) @IsInt({ each: true }) kitIds!: number[];
}

/** Bipa o kit para conferência/finalização. */
export class BiparKitDto {
  @IsString() @IsNotEmpty() codigo!: string;
}

/** Alteração do lote do tecido de um kit (auditada, só autorizado). */
export class AlterarLoteKitDto {
  @IsInt() @IsPositive() loteTecidoId!: number;
  @IsString() @IsNotEmpty({ message: 'Informe o motivo da alteração de lote.' }) @MaxLength(200) motivo!: string;
}

/** Envio automatizado da OP para uma facção externa (gera controle + expede + vincula lote). */
export class EnviarFaccaoDto {
  @IsInt() @IsPositive() opId!: number;
  @IsOptional() @IsInt() @IsPositive() faccaoId?: number;
  @IsOptional() @IsString() @MaxLength(120) faccaoNome?: string;
  @IsString() @IsNotEmpty({ message: 'Informe a operação (ex.: Estamparia/Bordado, Costura).' }) @MaxLength(60) operacao!: string;
  @IsOptional() @IsString() @MaxLength(80) loteTecidoNf?: string;
  @IsOptional() @IsString() @MaxLength(120) transportador?: string;
}
