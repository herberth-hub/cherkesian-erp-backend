import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ExpedicoesService } from './expedicoes.service';
import { CreateExpedicaoDto } from './dto/create-expedicao.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('expedicao')
@Controller('expedicoes')
export class ExpedicoesController {
  constructor(private readonly expedicoesService: ExpedicoesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.expedicoesService.findAll(user.empresaId);
  }

  /** Arquiva a foto do canhoto assinado da NF. */
  @Post(':id/canhoto')
  @HttpCode(HttpStatus.OK)
  salvarCanhoto(@Param('id', ParseIntPipe) id: number, @Body('img') img: string, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.salvarCanhoto(id, user.empresaId, img);
  }

  /** Retorna a foto do canhoto arquivado. */
  @Get(':id/canhoto')
  getCanhoto(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.getCanhoto(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateExpedicaoDto, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.create(dto, user.empresaId);
  }

  /** Gera a expedição direto do pedido (sem OP) — revenda/faturamento. */
  @Areas('vendas', 'expedicao')
  @Post('do-pedido/:pedidoId')
  @HttpCode(HttpStatus.CREATED)
  criarDoPedido(@Param('pedidoId', ParseIntPipe) pedidoId: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.criarDoPedido(pedidoId, user.empresaId);
  }

  @Areas('vendas', 'expedicao')
  @Post('parcial/:pedidoId')
  @HttpCode(HttpStatus.CREATED)
  criarParcial(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @Body() dto: { itens: Array<{ pedidoItemId: number; quantidade?: number; grade?: Record<string, number> }> },
    @CurrentUser() user: AuthUser,
  ) {
    return this.expedicoesService.criarParcial(pedidoId, dto, user.empresaId);
  }

  /** Etiqueta de expedição (QR + código de barras) preenchida do pedido. */
  @Get(':id/etiqueta')
  etiqueta(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.etiqueta(id, user.empresaId);
  }

  /** Etiquetas unitárias (1 por peça) para bipagem 1-a-1 na conferência. */
  @Get(':id/etiquetas-unitarias')
  etiquetasUnitarias(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.etiquetasUnitarias(id, user.empresaId);
  }

  // ===== Plano de embalagem por caixa =====
  @Post(':id/caixas')
  @HttpCode(HttpStatus.OK)
  salvarCaixas(@Param('id', ParseIntPipe) id: number, @Body() body: { caixas?: unknown[] }, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.salvarCaixas(id, user.empresaId, (body?.caixas ?? []) as never);
  }

  @Get(':id/caixas/etiquetas')
  etiquetasCaixas(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.etiquetasCaixas(id, user.empresaId);
  }

  // ===== Dupla conferência + despacho =====
  @Get(':id/conferencia')
  conferencia(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.conferencia(id, user.empresaId);
  }

  @Post(':id/conferir')
  @HttpCode(HttpStatus.OK)
  conferir(@Param('id', ParseIntPipe) id: number, @Body('codigo') codigo: string, @Body('caixa') caixa: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.conferir(id, user.empresaId, codigo, user.usuario, caixa);
  }

  @Post(':id/zerar-conferencia')
  @HttpCode(HttpStatus.OK)
  zerarConferencia(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    if (user.acesso !== 'total') {
      throw new ForbiddenException('Apenas o administrador da conta pode zerar a conferência.');
    }
    return this.expedicoesService.zerarConferencia(id, user.empresaId);
  }

  @Post(':id/despachar')
  @HttpCode(HttpStatus.OK)
  despachar(
    @Param('id', ParseIntPipe) id: number,
    @Body('codigoMaster') codigoMaster: string,
    @Body('forcar') forcar: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    // Baixa direta (sem conferir peça a peça) só para o administrador da conta.
    const forcarAdmin = !!forcar && user.acesso === 'total';
    return this.expedicoesService.despachar(id, user.empresaId, user.usuario, codigoMaster, forcarAdmin);
  }

  /** Estorna a expedição (volta a operação pro pedido de venda p/ reexpedir/parcial). */
  @Post(':id/estornar')
  @HttpCode(HttpStatus.OK)
  estornar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.estornar(id, user.empresaId);
  }
}
