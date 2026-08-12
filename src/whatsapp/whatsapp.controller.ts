import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { WhatsappService } from './whatsapp.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { Public } from '../common/decorators/public.decorator';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  // ===== Admin (autenticado) =====
  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.empresaId);
  }

  @Post('config')
  salvarConfig(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.salvarConfig(user.empresaId, dto as never);
  }

  @Get('conversas')
  conversas(@CurrentUser() user: AuthUser) {
    return this.service.listarConversas(user.empresaId);
  }

  @Get('conversas/:id')
  conversa(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.detalheConversa(user.empresaId, id);
  }

  @Post('conversas/:id/assumir')
  assumir(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.assumir(user.empresaId, id, user.nome || user.usuario || 'operador');
  }

  @Post('conversas/:id/responder')
  responder(@Param('id', ParseIntPipe) id: number, @Body('texto') texto: string, @CurrentUser() user: AuthUser) {
    return this.service.responderHumano(user.empresaId, id, texto);
  }

  @Post('conversas/:id/devolver')
  devolver(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.devolverAoBot(user.empresaId, id);
  }

  /** Simulador: injeta uma mensagem "do cliente" e retorna a resposta do robô. */
  @Post('simular')
  simular(@Body() dto: { telefone: string; texto: string; nome?: string }, @CurrentUser() user: AuthUser) {
    return this.service.receberMensagem(user.empresaId, dto.telefone, dto.texto, dto.nome);
  }

  // ===== Webhook do provedor (público) =====
  /** Verificação do webhook (Meta Cloud API). */
  @Public()
  @Get('webhook')
  verify(@Query('hub.challenge') challenge: string) {
    return challenge ?? 'ok';
  }

  /** Recebe mensagens do provedor. Normaliza Meta e Z-API. empresaId=1 (single-tenant). */
  @Public()
  @Post('webhook')
  async webhook(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const empresaId = 1;
    try {
      // Meta Cloud API
      const entry = (body as any)?.entry?.[0]?.changes?.[0]?.value;
      const metaMsg = entry?.messages?.[0];
      if (metaMsg?.from && metaMsg?.text?.body) {
        const nome = entry?.contacts?.[0]?.profile?.name;
        await this.service.receberMensagem(empresaId, metaMsg.from, metaMsg.text.body, nome);
        return { received: true };
      }
      // Z-API
      const z = body as any;
      if (z?.phone && (z?.text?.message || z?.message)) {
        await this.service.receberMensagem(empresaId, z.phone, z.text?.message || z.message, z.senderName);
        return { received: true };
      }
    } catch {
      // engole erros p/ não fazer o provedor re-tentar em loop
    }
    return { received: true };
  }
}
