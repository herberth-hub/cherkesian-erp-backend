import { Module } from '@nestjs/common';
import { BancosController } from './bancos.controller';
import { BancosService } from './bancos.service';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { EmailModule } from '../email/email.module';

/** Integração bancária (CNAB/API): remessa, retorno e boletos das contas a receber. */
@Module({
  imports: [FinanceiroModule, EmailModule],
  controllers: [BancosController],
  providers: [BancosService],
  exports: [BancosService],
})
export class BancosModule {}
