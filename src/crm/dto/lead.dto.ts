import { IsInt, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const ETAPAS_FUNIL = ['novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'] as const;
export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

export class CreateLeadDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome do lead.' }) @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(160) empresa?: string;
  @IsOptional() @IsString() @MaxLength(20) cnpjCpf?: string;
  @IsOptional() @IsString() @MaxLength(120) contato?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(80) cidadeUf?: string;
  @IsOptional() @IsString() @MaxLength(60) origem?: string;
  @IsOptional() @IsIn(ETAPAS_FUNIL as unknown as string[]) etapa?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) valorEstimado?: number;
  @IsOptional() @IsString() @MaxLength(200) proximaAcao?: string;
  @IsOptional() @IsString() @MaxLength(30) proximaAcaoEm?: string;
  @IsOptional() @IsString() @MaxLength(2000) obs?: string;
  // ===== Qualificação =====
  @IsOptional() @IsInt() @Min(0) qtdColaboradores?: number;
  @IsOptional() @IsInt() @Min(0) trocasUniforme?: number;
  @IsOptional() @IsString() @MaxLength(30) frequenciaCompra?: string;
  @IsOptional() @IsString() @MaxLength(120) precoAtual?: string;
  @IsOptional() @IsString() @MaxLength(120) formaPagamentoAtual?: string;
  /** Só managers (total/comercial) podem atribuir a outro vendedor. */
  @IsOptional() @IsInt() vendedorId?: number;
  @IsOptional() @IsString() @MaxLength(120) vendedorNome?: string;
}

export class UpdateLeadDto extends CreateLeadDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) nome!: string;
}

export class MoverEtapaDto {
  @IsIn(ETAPAS_FUNIL as unknown as string[], { message: 'Etapa inválida do funil.' })
  etapa!: string;
  @IsOptional() @IsString() @MaxLength(200) perdaMotivo?: string;
}

export class InteracaoDto {
  @IsOptional() @IsIn(['nota', 'ligacao', 'email', 'reuniao', 'whatsapp', 'proposta']) tipo?: string;
  @IsString() @IsNotEmpty({ message: 'Escreva a interação.' }) @MaxLength(4000) texto!: string;
}

export class ConverterLeadDto {
  /** Se informado, vincula a um cliente existente; senão cria um novo a partir do lead. */
  @IsOptional() @IsInt() clienteId?: number;
}
