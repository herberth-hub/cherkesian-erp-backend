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
import { ComprasService } from './compras.service';
import { CreateOrdemCompraDto } from './dto/create-ordem-compra.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('compras')
@Controller('ordens-compra')
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.comprasService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.comprasService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateOrdemCompraDto, @CurrentUser() user: AuthUser) {
    return this.comprasService.create(dto, user.empresaId);
  }

  @Post(':id/receber')
  @HttpCode(HttpStatus.OK)
  receber(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.comprasService.receber(id, user.empresaId);
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.comprasService.cancelar(id, user.empresaId);
  }
}
