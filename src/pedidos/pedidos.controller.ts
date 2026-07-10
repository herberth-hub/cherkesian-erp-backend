import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  @Areas('vendas')
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.pedidosService.findAll(user.empresaId);
  }

  @Areas('vendas', 'pcp')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.findOne(id, user.empresaId);
  }

  @Areas('vendas')
  @Post()
  create(@Body() dto: CreatePedidoDto, @CurrentUser() user: AuthUser) {
    return this.pedidosService.create(dto, user.empresaId, user.usuario);
  }

  @Areas('vendas')
  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  aprovar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.aprovar(id, user.empresaId);
  }

  // Ação de PCP/Produção: dispara a automação de material/OP.
  @Areas('pcp', 'producao')
  @Post(':id/gerar-op')
  @HttpCode(HttpStatus.OK)
  gerarOp(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.gerarOp(id, user.empresaId);
  }
}
