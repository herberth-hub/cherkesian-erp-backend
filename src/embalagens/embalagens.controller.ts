import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { EmbalagensService } from './embalagens.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('embalagens')
export class EmbalagensController {
  constructor(private readonly service: EmbalagensService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.empresaId);
  }

  @Post()
  salvar(@Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.salvar(user.empresaId, dto as never);
  }

  @Get('peso/:pedidoId')
  peso(@Param('pedidoId', ParseIntPipe) pedidoId: number, @CurrentUser() user: AuthUser) {
    return this.service.pesoDoPedido(user.empresaId, pedidoId);
  }

  @Delete(':id')
  remover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.remover(user.empresaId, id);
  }
}
