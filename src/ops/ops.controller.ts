import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { OpsService } from './ops.service';
import { UpdateOpEntregaDto, UpdateOpGradeDto, UpdateOpProgressoDto, UpdateOpStatusDto } from './dto/update-op.dto';
import { CreateOpAvulsaDto } from './dto/create-op-avulsa.dto';
import { CreateOpAvulsaLoteDto } from './dto/create-op-avulsa-lote.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('pcp', 'producao')
@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.opsService.findAll(user.empresaId);
  }

  /** Cria uma OP AVULSA (produção sem pedido). */
  @Post('avulsa')
  criarAvulsa(@Body() dto: CreateOpAvulsaDto, @CurrentUser() user: AuthUser) {
    return this.opsService.criarAvulsa(dto, user.empresaId);
  }

  /** Cria VÁRIAS OPs avulsas de uma vez (multi-produto), agrupadas por lote. */
  @Post('avulsa-lote')
  criarAvulsaLote(@Body() dto: CreateOpAvulsaLoteDto, @CurrentUser() user: AuthUser) {
    return this.opsService.criarAvulsaLote(dto, user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.opsService.findOne(id, user.empresaId);
  }

  /** Romaneio de corte: materiais a separar para a OP (com status de conferência). */
  @Areas('pcp', 'producao', 'estoque')
  @Get(':id/romaneio')
  romaneio(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.opsService.romaneio(id, user.empresaId);
  }

  /** Dupla conferência do estoquista: bipa o material/rolo do romaneio (não baixa saldo). */
  @Areas('pcp', 'producao', 'estoque')
  @Post(':id/conferir-material')
  @HttpCode(HttpStatus.OK)
  conferirMaterial(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { codigo: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.conferirMaterial(id, body?.codigo ?? '', user.empresaId, user.usuario);
  }

  /** Reserva manual de lotes do fornecedor por material (rastreio, sem baixar saldo). */
  @Areas('pcp', 'producao', 'estoque')
  @Post(':id/romaneio-lotes')
  @HttpCode(HttpStatus.OK)
  salvarLotes(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { itens: { codigo?: string; materialId?: number; lote: string }[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.salvarLotes(id, user.empresaId, body?.itens ?? []);
  }

  /** Etiqueta do fardo (corte) para a Zebra: dados + ZPL. destino = facção/setor. */
  @Get(':id/etiqueta')
  etiqueta(
    @Param('id', ParseIntPipe) id: number,
    @Query('destino') destino: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.etiqueta(id, user.empresaId, destino);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateStatus(id, dto, user.empresaId, user.sub);
  }

  /** Vencimento da OP: herdado do pedido, mas corrigível (cliente antecipa/adia). */
  @Areas('pcp', 'producao')
  @Patch(':id/entrega')
  definirEntrega(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpEntregaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.definirEntrega(id, dto.entregaPrev, user.empresaId, user.usuario);
  }

  @Patch(':id/grade')
  updateGrade(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpGradeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateGrade(id, dto.grade, user.empresaId);
  }

  /** Confirmação de corte pelo setor (permite parcial quando acaba o tecido). */
  @Areas('pcp', 'producao')
  @Patch(':id/corte')
  registrarCorte(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { grade?: Record<string, unknown>; obs?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.registrarCorte(id, body?.grade ?? {}, body?.obs, user.empresaId, user.sub);
  }

  /**
   * Conclusão PARCIAL: fecha só a grade que ficou pronta; o resto segue na fase atual.
   *
   * `semEtiqueta: true` = BAIXA SEM ETIQUETA: fecha a ordem sem criar peça no
   * estoque, para OP cuja peça já foi entregue (etiquetar agora duplicaria o
   * estoque). Nesse caso o `motivo` é obrigatório. Quem gera as etiquetas é a
   * tela, chamando /estoque/entrada antes — aqui nunca nasce etiqueta.
   */
  @Areas('pcp', 'producao')
  @Patch(':id/concluir-parcial')
  concluirParcial(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { grade?: Record<string, unknown>; semEtiqueta?: boolean; motivo?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.opsService.concluirParcial(id, body?.grade ?? {}, user.empresaId, {
      semEtiqueta: body?.semEtiqueta === true,
      motivo: body?.motivo,
      usuario: user.usuario,
      usuarioId: user.sub,
      ip: this.ipDoPedido(req),
    });
  }

  /** IP real por trás do proxy do Render (mesma regra da auditoria global). */
  private ipDoPedido(req: Request): string | undefined {
    const fwd = req?.headers?.['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return req?.ip ?? req?.socket?.remoteAddress ?? undefined;
  }

  /** Avança PARTE da grade de fase (priorizar um tamanho sem levar o resto junto). */
  @Areas('pcp', 'producao')
  @Patch(':id/avancar-fase')
  avancarFase(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { de?: string; para?: string; grade?: Record<string, unknown> },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.avancarFaseParcial(id, String(body?.de ?? ''), String(body?.para ?? ''), body?.grade ?? {}, user.empresaId, user.sub);
  }

  @Patch(':id/progresso')
  updateProgresso(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpProgressoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateProgresso(id, dto, user.empresaId);
  }
}
