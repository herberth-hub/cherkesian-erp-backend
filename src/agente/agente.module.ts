import { Module } from '@nestjs/common';
import { AgenteController } from './agente.controller';
import { AgenteService } from './agente.service';
import { PedidosModule } from '../pedidos/pedidos.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [PedidosModule, ClientesModule],
  controllers: [AgenteController],
  providers: [AgenteService],
})
export class AgenteModule {}
