import { Controller, Get } from '@nestjs/common';
import { PcpService } from './pcp.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('pcp')
@Controller('pcp')
export class PcpController {
  constructor(private readonly pcpService: PcpService) {}

  @Get('painel')
  painel(@CurrentUser() user: AuthUser) {
    return this.pcpService.painel(user.empresaId);
  }

  @Get('capacidade')
  capacidade(@CurrentUser() user: AuthUser) {
    return this.pcpService.capacidade(user.empresaId);
  }
}
