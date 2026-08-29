import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CrmService } from './crm.service';
import { ConverterLeadDto, CreateLeadDto, InteracaoDto, MoverEtapaDto, UpdateLeadDto } from './dto/lead.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('crm')
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.crm.resumo(user);
  }

  @Get('vendedores')
  vendedores(@CurrentUser() user: AuthUser) {
    return this.crm.vendedores(user);
  }

  @Get('leads')
  listar(@CurrentUser() user: AuthUser, @Query('etapa') etapa?: string) {
    return this.crm.listar(user, etapa);
  }

  @Get('leads/:id')
  obter(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.crm.obter(id, user);
  }

  @Post('leads')
  criar(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.crm.criar(dto, user);
  }

  @Patch('leads/:id')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLeadDto, @CurrentUser() user: AuthUser) {
    return this.crm.atualizar(id, dto, user);
  }

  @Patch('leads/:id/etapa')
  moverEtapa(@Param('id', ParseIntPipe) id: number, @Body() dto: MoverEtapaDto, @CurrentUser() user: AuthUser) {
    return this.crm.moverEtapa(id, dto, user);
  }

  @Post('leads/:id/interacao')
  interacao(@Param('id', ParseIntPipe) id: number, @Body() dto: InteracaoDto, @CurrentUser() user: AuthUser) {
    return this.crm.registrarInteracao(id, dto, user);
  }

  @Post('leads/:id/converter')
  converter(@Param('id', ParseIntPipe) id: number, @Body() dto: ConverterLeadDto, @CurrentUser() user: AuthUser) {
    return this.crm.converter(id, dto, user);
  }

  @Delete('leads/:id')
  remover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.crm.remover(id, user);
  }
}
