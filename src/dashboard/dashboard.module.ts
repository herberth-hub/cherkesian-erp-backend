import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FinanceiroModule } from '../financeiro/financeiro.module';

@Module({
  imports: [FinanceiroModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
