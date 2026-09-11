import { Global, Module } from '@nestjs/common';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';

// @Global: o NotificacoesService pode ser injetado em qualquer módulo (pedidos, ops)
// sem precisar reimportar o módulo — mesmo padrão do EmailService.
@Global()
@Module({
  controllers: [NotificacoesController],
  providers: [NotificacoesService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
