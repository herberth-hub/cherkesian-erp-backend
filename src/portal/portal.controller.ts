import { Controller, Get, Query } from '@nestjs/common';
import { PortalService } from './portal.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * Portal do Cliente. Restrito à área `portal` — só o perfil `cliente` (e o admin
 * `total`, para pré-visualizar) chega aqui. O escopo do cliente é travado no token.
 */
@Areas('portal')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.resumo(user, clienteId ? Number(clienteId) : undefined);
  }

  @Get('estoque')
  estoque(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.estoque(user, clienteId ? Number(clienteId) : undefined);
  }

  @Get('producao')
  producao(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.producao(user, clienteId ? Number(clienteId) : undefined);
  }
}
