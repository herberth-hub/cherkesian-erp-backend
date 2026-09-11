import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { NotificacoesService } from './notificacoes.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Sem @Areas: qualquer usuário logado vê e dá ciência das SUAS notificações
// (o serviço já filtra pelas áreas do perfil).
@Controller('notificacoes')
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Get('pendentes')
  pendentes(@CurrentUser() user: AuthUser) {
    return this.notificacoes.pendentes(user);
  }

  @Post('ciente-todas')
  @HttpCode(HttpStatus.OK)
  cienteTodas(@CurrentUser() user: AuthUser) {
    return this.notificacoes.marcarTodas(user);
  }

  @Post(':id/ciente')
  @HttpCode(HttpStatus.OK)
  ciente(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.notificacoes.marcarCiente(id, user);
  }
}
