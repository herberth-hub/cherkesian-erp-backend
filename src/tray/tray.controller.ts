import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TrayService } from './tray.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Integração é configuração sensível: somente o administrador da conta.
@Areas('cadastros')
@Controller('tray')
export class TrayController {
  constructor(private readonly service: TrayService) {}

  private soAdmin(user: AuthUser) {
    if (user.acesso !== 'total') throw new ForbiddenException('Apenas o administrador pode configurar integrações.');
  }

  @Get('contas')
  contas(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.empresaId);
  }

  @Post('contas')
  @HttpCode(HttpStatus.OK)
  salvar(
    @Body() body: { id?: number; apelido?: string; consumerKey?: string; consumerSecret?: string; apiUrl?: string; code?: string },
    @CurrentUser() user: AuthUser,
  ) {
    this.soAdmin(user);
    return this.service.salvar(user.empresaId, body ?? {});
  }

  @Delete('contas/:id')
  remover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.service.remover(user.empresaId, id);
  }

  @Post('contas/:id/conectar')
  @HttpCode(HttpStatus.OK)
  conectar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.service.conectar(user.empresaId, id);
  }

  @Post('contas/:id/desconectar')
  @HttpCode(HttpStatus.OK)
  desconectar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.service.desconectar(user.empresaId, id);
  }

  @Get('contas/:id/pedidos')
  pedidos(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.buscarPedidos(user.empresaId, id);
  }

  @Post('contas/:id/pedidos/:orderId/importar')
  @HttpCode(HttpStatus.OK)
  importar(@Param('id', ParseIntPipe) id: number, @Param('orderId') orderId: string, @CurrentUser() user: AuthUser) {
    return this.service.importarPedido(user.empresaId, id, orderId);
  }
}
