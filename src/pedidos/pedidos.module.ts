import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { CreditoModule } from '../credito/credito.module';
import { EstoqueModule } from '../estoque/estoque.module';

@Module({
  imports: [CreditoModule, EstoqueModule],
  controllers: [PedidosController],
  providers: [PedidosService],
  exports: [PedidosService],
})
export class PedidosModule {}
