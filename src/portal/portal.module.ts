import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { NfeModule } from '../nfe/nfe.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  // Notificações e E-mail são @Global (não precisam ser importados).
  imports: [NfeModule, PedidosModule, LogsModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
