import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { NfeModule } from '../nfe/nfe.module';
import { PedidosModule } from '../pedidos/pedidos.module';

@Module({
  // Notificações e E-mail são @Global (não precisam ser importados).
  imports: [NfeModule, PedidosModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
