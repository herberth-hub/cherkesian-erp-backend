import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  kpis(@CurrentUser() user: AuthUser) {
    return this.dashboardService.kpis(user.empresaId, user.acesso);
  }

  /** Painel do Diretor: índices (0–100) por pilar da empresa. */
  @Get('indices')
  indices(@CurrentUser() user: AuthUser) {
    return this.dashboardService.indices(user.empresaId);
  }

  /** Mapa mental de causa raiz de um pilar (drill-down até o registro). */
  @Get('drill')
  drill(@CurrentUser() user: AuthUser, @Query('pilar') pilar: string) {
    return this.dashboardService.drill(user.empresaId, pilar || '');
  }
}
