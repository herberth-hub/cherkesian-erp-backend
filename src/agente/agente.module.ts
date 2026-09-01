import { Module } from '@nestjs/common';
import { AgenteController } from './agente.controller';
import { AgenteService } from './agente.service';
import { PedidosModule } from '../pedidos/pedidos.module';
import { ClientesModule } from '../clientes/clientes.module';
import { RhModule } from '../rh/rh.module';

@Module({
  imports: [PedidosModule, ClientesModule, RhModule],
  controllers: [AgenteController],
  providers: [AgenteService],
})
export class AgenteModule {}
