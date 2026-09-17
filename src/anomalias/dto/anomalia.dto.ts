import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** O que deu errado. Guia a ação: troca e falta vão para produção/expedição; nota vai p/ o fiscal. */
export const TIPOS = ['defeito', 'tamanho', 'cor', 'falta', 'troca', 'atraso', 'entrega', 'nota', 'outro'] as const;
export const GRAVIDADES = ['baixa', 'media', 'alta'] as const;
export const ORIGENS = ['cliente', 'interna', 'portal'] as const;
export const SETORES = ['comercial', 'producao', 'expedicao', 'qualidade', 'financeiro'] as const;
/** Fluxo: aberta → analise → acao → execucao → resolvida (ou cancelada a qualquer momento). */
export const STATUS = ['aberta', 'analise', 'acao', 'execucao', 'resolvida', 'cancelada'] as const;

export type TipoAnomalia = (typeof TIPOS)[number];
export type StatusAnomalia = (typeof STATUS)[number];

export class CriarAnomaliaDto {
  @IsOptional() @IsInt() @IsPositive() pedidoId?: number;
  @IsOptional() @IsInt() @IsPositive() clienteId?: number;
  @IsOptional() @IsInt() @IsPositive() notaFiscalId?: number;
  @IsOptional() @IsInt() @IsPositive() produtoId?: number;

  /** Peça afetada, como o cliente descreve. */
  @IsOptional() @IsString() @MaxLength(200) itemDescricao?: string;
  @IsOptional() @IsString() @MaxLength(120) cor?: string;
  @IsOptional() @IsString() @MaxLength(20) tamanho?: string;
  @IsOptional() @IsInt() @IsPositive() quantidade?: number;

  @IsIn(TIPOS as unknown as string[]) tipo!: string;
  @IsOptional() @IsIn(GRAVIDADES as unknown as string[]) gravidade?: string;
  @IsOptional() @IsIn(ORIGENS as unknown as string[]) origem?: string;
  @IsOptional() @IsIn(SETORES as unknown as string[]) setor?: string;

  @IsString() @MinLength(4) @MaxLength(200) titulo!: string;
  @IsString() @MinLength(4) @MaxLength(4000) descricao!: string;

  @IsOptional() @IsString() @MaxLength(150) responsavel?: string;
  @IsOptional() @IsISO8601() prazo?: string;

  /** Foto do defeito (data URI). Uma imagem resolve mais que três parágrafos. */
  @IsOptional() @IsString() anexo?: string;
  @IsOptional() @IsString() @MaxLength(200) anexoNome?: string;
}

export class AtualizarAnomaliaDto {
  @IsOptional() @IsIn(GRAVIDADES as unknown as string[]) gravidade?: string;
  @IsOptional() @IsIn(SETORES as unknown as string[]) setor?: string;
  @IsOptional() @IsString() @MaxLength(150) responsavel?: string;
  @IsOptional() @IsString() @MaxLength(4000) acao?: string;
  @IsOptional() @IsISO8601() prazo?: string;
  @IsOptional() @IsIn(TIPOS as unknown as string[]) tipo?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(200) titulo?: string;
}

export class MoverStatusDto {
  @IsIn(STATUS as unknown as string[]) status!: string;
  /** Obrigatório ao resolver ou cancelar: o que foi feito (fica no histórico). */
  @IsOptional() @IsString() @MaxLength(4000) resolucao?: string;
}

export class ComentarDto {
  @IsOptional() @IsString() @MaxLength(4000) texto?: string;
  @IsOptional() @IsString() anexo?: string;
  @IsOptional() @IsString() @MaxLength(200) anexoNome?: string;
}
