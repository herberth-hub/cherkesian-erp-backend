import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { RhService } from './rh.service';
import { CreateFuncionarioDto, FeriasDto, PontoBatchDto, PontoItemDto, UpdateFuncionarioDto } from './dto/rh.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// RH: admin (total) + financeiro + contabilidade (para baixar a folha).
@Areas('rh')
@Controller('rh')
export class RhController {
  constructor(private readonly rh: RhService) {}

  // ---- Funcionários ----
  @Get('funcionarios')
  listar(@CurrentUser() user: AuthUser) {
    return this.rh.listar(user.empresaId);
  }

  @Get('funcionarios/:id')
  obter(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.rh.obter(id, user.empresaId);
  }

  @Post('funcionarios')
  criar(@Body() dto: CreateFuncionarioDto, @CurrentUser() user: AuthUser) {
    return this.rh.criar(dto, user.empresaId);
  }

  @Patch('funcionarios/:id')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFuncionarioDto, @CurrentUser() user: AuthUser) {
    return this.rh.atualizar(id, dto, user.empresaId);
  }

  @Delete('funcionarios/:id')
  remover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.rh.remover(id, user.empresaId);
  }

  // ---- Ponto ----
  @Get('funcionarios/:id/pontos')
  pontos(@Param('id', ParseIntPipe) id: number, @Query('mes') mes: string, @CurrentUser() user: AuthUser) {
    return this.rh.pontosDoMes(id, user.empresaId, mes);
  }

  @Post('pontos')
  salvarPonto(@Body() dto: PontoItemDto, @CurrentUser() user: AuthUser) {
    return this.rh.salvarPonto(dto, user.empresaId);
  }

  @Post('pontos/importar')
  importar(@Body() dto: PontoBatchDto, @CurrentUser() user: AuthUser) {
    return this.rh.importarPontos(dto, user.empresaId);
  }

  @Delete('pontos/:id')
  removerPonto(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.rh.removerPonto(id, user.empresaId);
  }

  // ---- Resumo mensal (folha p/ contabilidade) ----
  @Get('resumo')
  resumo(@Query('mes') mes: string, @CurrentUser() user: AuthUser) {
    return this.rh.resumoMes(user.empresaId, mes);
  }

  // ---- Férias / afastamentos ----
  @Get('ferias')
  listarFerias(@Query('funcionarioId') funcionarioId: string, @CurrentUser() user: AuthUser) {
    return this.rh.listarFerias(user.empresaId, funcionarioId ? Number(funcionarioId) : undefined);
  }

  @Post('ferias')
  criarFerias(@Body() dto: FeriasDto, @CurrentUser() user: AuthUser) {
    return this.rh.criarFerias(dto, user.empresaId);
  }

  @Delete('ferias/:id')
  removerFerias(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.rh.removerFerias(id, user.empresaId);
  }
}
