import { IsInt, IsPositive } from 'class-validator';

export class CreateDocumentoDto {
  /** Id do registro de origem (pedidoId, opId, ocId, expedicaoId, clienteId, loteId...). */
  @IsInt()
  @IsPositive()
  referenciaId!: number;
}
