import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { EstoqueAlertaScheduler } from './estoque-alerta.scheduler';
import { ComprasAtrasoScheduler } from './compras-atraso.scheduler';

@Module({
  controllers: [ComprasController],
  providers: [ComprasService, EstoqueAlertaScheduler, ComprasAtrasoScheduler],
  exports: [ComprasService],
})
export class ComprasModule {}
