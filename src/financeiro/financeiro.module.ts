import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { ContasReceberService } from './contas-receber.service';
import { ContasPagarService } from './contas-pagar.service';
import { ContasRecorrentesService } from './contas-recorrentes.service';

@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService, ContasReceberService, ContasPagarService, ContasRecorrentesService],
  exports: [FinanceiroService, ContasReceberService, ContasPagarService, ContasRecorrentesService],
})
export class FinanceiroModule {}
