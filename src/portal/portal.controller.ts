import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
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

  @Get('notas')
  notas(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.notas(user, clienteId ? Number(clienteId) : undefined);
  }

  /** Baixa DANFE (PDF) ou XML de uma nota do cliente. Escopo travado no service. */
  @Get('notas/:id/:tipo')
  async baixarNota(
    @Param('id', ParseIntPipe) id: number,
    @Param('tipo') tipo: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
    @Query('clienteId') clienteId?: string,
  ) {
    if (tipo !== 'danfe' && tipo !== 'xml') throw new BadRequestException('Tipo inválido (use danfe ou xml).');
    const a = await this.portal.baixarNota(user, id, tipo, clienteId ? Number(clienteId) : undefined);
    res.set({
      'Content-Type': a.contentType,
      'Content-Disposition': `${tipo === 'danfe' ? 'inline' : 'attachment'}; filename="${a.filename}"`,
    });
    return new StreamableFile(a.content);
  }
}
