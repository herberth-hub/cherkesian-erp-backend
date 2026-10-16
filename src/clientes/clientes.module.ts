import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { LookupModule } from '../lookup/lookup.module';

@Module({
  // Consulta de CNPJ/CEP na Receita — completa o cadastro fiscal do cliente.
  imports: [LookupModule],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
