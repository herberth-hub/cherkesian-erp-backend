import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsPositive } from 'class-validator';

export class CreateDocumentoDto {
  /** Id do registro de origem (pedidoId, opId, ocId, expedicaoId, clienteId, loteId...). */
  @IsInt()
  @IsPositive()
  referenciaId!: number;

  /**
   * Recorte do documento dentro da referência. Hoje: os títulos escolhidos no
   * demonstrativo de cobrança. Vazio = o documento inteiro (todos em aberto).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids?: number[];
}
