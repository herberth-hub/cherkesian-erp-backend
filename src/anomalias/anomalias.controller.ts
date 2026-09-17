import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { AnomaliasService } from './anomalias.service';
import {
  AtualizarAnomaliaDto,
  ComentarDto,
  CriarAnomaliaDto,
  MoverStatusDto,
} from './dto/anomalia.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * Canal de anomalias de pedido. A área é compartilhada de propósito: comercial abre,
 * produção e expedição executam, financeiro entra quando há nota/crédito. Todo mundo
 * envolvido lê a mesma linha do tempo.
 */
@Areas('anomalias')
@Controller('anomalias')
export class AnomaliasController {
  constructor(private readonly anomalias: AnomaliasService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.anomalias.resumo(user);
  }

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('tipo') tipo?: string,
    @Query('setor') setor?: string,
    @Query('pedidoId') pedidoId?: string,
    @Query('clienteId') clienteId?: string,
    @Query('todas') todas?: string,
  ) {
    return this.anomalias.listar(user, {
      status,
      tipo,
      setor,
      pedidoId: pedidoId ? Number(pedidoId) : undefined,
      clienteId: clienteId ? Number(clienteId) : undefined,
      incluirFechadas: todas === '1' || todas === 'true',
    });
  }

  @Get(':id')
  obter(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.anomalias.obter(id, user);
  }

  @Post()
  criar(@Body() dto: CriarAnomaliaDto, @CurrentUser() user: AuthUser) {
    return this.anomalias.criar(dto, user);
  }

  @Patch(':id')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarAnomaliaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.anomalias.atualizar(id, dto, user);
  }

  @Patch(':id/status')
  mover(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoverStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.anomalias.mover(id, dto, user);
  }

  @Post(':id/comentarios')
  comentar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ComentarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.anomalias.comentar(id, dto, user);
  }

  /** Foto do defeito / comprovante anexado a um evento. */
  @Get(':id/anexos/:eventoId')
  async anexo(
    @Param('id', ParseIntPipe) id: number,
    @Param('eventoId', ParseIntPipe) eventoId: number,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const a = await this.anomalias.anexo(id, eventoId, user);
    res.set({
      'Content-Type': a.contentType,
      'Content-Disposition': `inline; filename="${a.filename}"`,
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(a.content);
  }
}
