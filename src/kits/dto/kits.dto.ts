import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

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
  /** Lote do tecido usado no enfesto (obrigatório p/ rastreabilidade). */
  @IsInt() @IsPositive() loteTecidoId!: number;
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
  @IsOptional() @IsString() @MaxLength(300) obs?: string;
}

/** Retorno do kit da facção (leitura do QR/código). */
export class RetornarKitDto {
  @IsString() @IsNotEmpty() codigo!: string;
  @IsOptional() @IsInt() @Min(0) qtd?: number;
  @IsOptional() @IsString() @MaxLength(300) obs?: string;
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
