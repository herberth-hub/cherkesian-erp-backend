import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { ContasReceberService } from './contas-receber.service';
import { ContasPagarService } from './contas-pagar.service';

@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService, ContasReceberService, ContasPagarService],
  exports: [FinanceiroService, ContasReceberService, ContasPagarService],
})
export class FinanceiroModule {}
