import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
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

  /** Etiqueta de expedição (QR + código de barras) preenchida do pedido. */
  @Get(':id/etiqueta')
  etiqueta(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.etiqueta(id, user.empresaId);
  }
}
