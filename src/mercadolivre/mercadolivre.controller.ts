import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { MercadoLivreService } from './mercadolivre.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Integração é configuração sensível: somente o administrador da conta.
@Areas('cadastros')
@Controller('mercadolivre')
export class MercadoLivreController {
  constructor(private readonly service: MercadoLivreService) {}

  private soAdmin(user: AuthUser) {
    if (user.acesso !== 'total') throw new ForbiddenException('Apenas o administrador pode configurar integrações.');
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.empresaId);
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  salvarConfig(
    @Body() body: { appId?: string; appSecret?: string; redirectUri?: string },
    @CurrentUser() user: AuthUser,
  ) {
    this.soAdmin(user);
    return this.service.salvarConfig(user.empresaId, body ?? {});
  }

  @Get('auth-url')
  authUrl(@CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.service.authUrl(user.empresaId);
  }

  @Post('conectar')
  @HttpCode(HttpStatus.OK)
  conectar(@Body() body: { code?: string }, @CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.service.conectar(user.empresaId, body?.code ?? '');
  }

  @Post('desconectar')
  @HttpCode(HttpStatus.OK)
  desconectar(@CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.service.desconectar(user.empresaId);
  }

  // ===== Pedidos do Mercado Livre =====
  @Get('pedidos')
  pedidos(@CurrentUser() user: AuthUser) {
    return this.service.buscarPedidos(user.empresaId);
  }

  @Post('pedidos/:id/importar')
  @HttpCode(HttpStatus.OK)
  importar(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.importarPedido(user.empresaId, id);
  }
}
