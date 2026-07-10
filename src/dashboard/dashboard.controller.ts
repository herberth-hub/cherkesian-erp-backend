import { Controller, Get } from '@nestjs/common';
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
    return this.dashboardService.kpis(user.empresaId);
  }
}
