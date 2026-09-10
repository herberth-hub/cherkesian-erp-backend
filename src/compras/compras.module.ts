import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { EstoqueAlertaScheduler } from './estoque-alerta.scheduler';

@Module({
  controllers: [ComprasController],
  providers: [ComprasService, EstoqueAlertaScheduler],
  exports: [ComprasService],
})
export class ComprasModule {}
