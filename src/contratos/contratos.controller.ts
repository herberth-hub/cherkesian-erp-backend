import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Comercial: contratos ficam sob Vendas/Clientes.
@Areas('vendas', 'clientes')
@Controller('contratos')
export class ContratosController {
  constructor(private readonly contratos: ContratosService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.contratos.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.contratos.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateContratoDto, @CurrentUser() user: AuthUser) {
    return this.contratos.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContratoDto, @CurrentUser() user: AuthUser) {
    return this.contratos.update(id, dto, user.empresaId);
  }

  @Patch(':id/ativo')
  setAtivo(@Param('id', ParseIntPipe) id: number, @Body('ativo') ativo: boolean, @CurrentUser() user: AuthUser) {
    return this.contratos.setAtivo(id, user.empresaId, !!ativo);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.contratos.remove(id, user.empresaId);
  }
}
