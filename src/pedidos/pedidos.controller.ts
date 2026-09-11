import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
    // Vendedor vê só os pedidos dele; managers veem todos.
    const scope = user.acesso === 'vendedor' ? { vendedorId: user.sub, usuario: user.usuario } : undefined;
    return this.pedidosService.findAll(user.empresaId, scope);
  }

  // Rota literal ANTES de ':id' (senão o ParseIntPipe captura "aguardando-material").
  @Areas('vendas', 'pcp', 'producao', 'compras')
  @Get('aguardando-material')
  aguardandoMaterial(@CurrentUser() user: AuthUser) {
    return this.pedidosService.aguardandoMaterial(user.empresaId);
  }

  @Areas('vendas', 'pcp')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.findOne(id, user.empresaId);
  }

  /** Pedidos-filhos parciais (desmembramento) + residual do pedido (o que falta expedir). */
  @Areas('vendas', 'pcp')
  @Get(':id/parciais')
  parciais(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.parciais(id, user.empresaId);
  }

  @Areas('vendas')
  @Post()
  create(@Body() dto: CreatePedidoDto, @CurrentUser() user: AuthUser) {
    // Atribui a venda ao vendedor logado (base da comissão/CRM).
    return this.pedidosService.create(dto, user.empresaId, user.usuario, user.sub);
  }

  @Areas('vendas')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreatePedidoDto, @CurrentUser() user: AuthUser) {
    return this.pedidosService.update(id, dto, user.empresaId);
  }

  @Areas('vendas')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.remove(id, user.empresaId);
  }

  @Areas('vendas')
  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.cancelar(id, user.empresaId);
  }

  @Areas('vendas')
  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  aprovar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pedidosService.aprovar(id, user.empresaId);
  }

  /** Marca/desmarca BONIFICAÇÃO sem mexer nos itens (não esbarra na trava de quantidade já expedida). */
  @Areas('vendas')
  @Post(':id/bonificacao')
  @HttpCode(HttpStatus.OK)
  definirBonificacao(@Param('id', ParseIntPipe) id: number, @Body() body: { bonificacao?: boolean }, @CurrentUser() user: AuthUser) {
    return this.pedidosService.definirBonificacao(id, user.empresaId, body?.bonificacao !== false);
  }

  // Ação de PCP/Produção: dispara a automação de material/OP.
  @Areas('pcp', 'producao')
  @Post(':id/gerar-op')
  @HttpCode(HttpStatus.OK)
  gerarOp(@Param('id', ParseIntPipe) id: number, @Query('parcial') parcial: string, @CurrentUser() user: AuthUser) {
    return this.pedidosService.gerarOp(id, user.empresaId, parcial === '1' || parcial === 'true');
  }
}
