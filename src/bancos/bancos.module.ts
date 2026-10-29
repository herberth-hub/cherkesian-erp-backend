import { Module } from '@nestjs/common';
import { BancosController } from './bancos.controller';
import { BancosService } from './bancos.service';
import { ExtratoController } from './extrato/extrato.controller';
import { ExtratoService } from './extrato/extrato.service';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { EmailModule } from '../email/email.module';

/**
 * Integração bancária: remessa/retorno de cobrança (CNAB) e o EXTRATO
 * espelhado com conciliação — os dois lados da mesma conta.
 */
@Module({
  imports: [FinanceiroModule, EmailModule],
  controllers: [BancosController, ExtratoController],
  providers: [BancosService, ExtratoService],
  exports: [BancosService, ExtratoService],
})
export class BancosModule {}
