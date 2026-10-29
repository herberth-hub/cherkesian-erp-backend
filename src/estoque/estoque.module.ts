import { Module } from '@nestjs/common';
import { EstoqueController } from './estoque.controller';
import { EstoqueService } from './estoque.service';
import { ComodatoVendaService } from './comodato-venda.service';

@Module({
  controllers: [EstoqueController],
  providers: [EstoqueService, ComodatoVendaService],
  exports: [EstoqueService],
})
export class EstoqueModule {}
