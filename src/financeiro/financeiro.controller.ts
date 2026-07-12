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
import { TituloStatus } from '@prisma/client';
import { ContasReceberService } from './contas-receber.service';
import { ContasPagarService } from './contas-pagar.service';
import { FinanceiroService } from './financeiro.service';
import { CreateContaReceberDto } from './dto/create-conta-receber.dto';
import { CreateContaPagarDto } from './dto/create-conta-pagar.dto';
import { CreateComissaoDto } from './dto/create-comissao.dto';
import { UpdateComissaoDto } from './dto/update-comissao.dto';
import { BaixarDto } from './dto/baixar.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('financeiro')
export class FinanceiroController {
  constructor(
    private readonly receber: ContasReceberService,
    private readonly pagar: ContasPagarService,
    private readonly financeiro: FinanceiroService,
  ) {}

  // ===== A receber (financeiro + comercial) =====
  @Areas('receber')
  @Get('receber')
  listarReceber(@CurrentUser() user: AuthUser, @Query('status') status?: TituloStatus) {
    return this.receber.findAll(user.empresaId, status);
  }

  @Areas('receber')
  @Post('receber')
  criarReceber(@Body() dto: CreateContaReceberDto, @CurrentUser() user: AuthUser) {
    return this.receber.create(dto, user.empresaId);
  }

  @Areas('receber')
  @Post('receber/:id/baixar')
  @HttpCode(HttpStatus.OK)
  baixarReceber(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BaixarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receber.baixar(id, user.empresaId, dto.valor);
  }

  // ===== A pagar (financeiro) =====
  @Areas('pagar')
  @Get('pagar')
  listarPagar(@CurrentUser() user: AuthUser, @Query('status') status?: TituloStatus) {
    return this.pagar.findAll(user.empresaId, status);
  }

  @Areas('pagar')
  @Post('pagar')
  criarPagar(@Body() dto: CreateContaPagarDto, @CurrentUser() user: AuthUser) {
    return this.pagar.create(dto, user.empresaId);
  }

  @Areas('pagar')
  @Post('pagar/:id/baixar')
  @HttpCode(HttpStatus.OK)
  baixarPagar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BaixarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pagar.baixar(id, user.empresaId, dto.valor);
  }

  // ===== Fluxo de caixa =====
  @Areas('fluxo')
  @Get('fluxo')
  fluxo(@CurrentUser() user: AuthUser) {
    return this.financeiro.fluxo(user.empresaId);
  }

  // ===== Comissões (financeiro + comercial) =====
  @Areas('comissoes')
  @Get('comissoes')
  listarComissoes(@CurrentUser() user: AuthUser) {
    return this.financeiro.listarComissoes(user.empresaId);
  }

  @Areas('comissoes')
  @Post('comissoes')
  criarComissao(@Body() dto: CreateComissaoDto, @CurrentUser() user: AuthUser) {
    return this.financeiro.criarComissao(dto, user.empresaId);
  }

  @Areas('comissoes')
  @Post('comissoes/:id/pagar')
  @HttpCode(HttpStatus.OK)
  pagarComissao(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.financeiro.pagarComissao(id, user.empresaId);
  }

  @Areas('comissoes')
  @Patch('comissoes/:id')
  editarComissao(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateComissaoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.financeiro.editarComissao(id, dto, user.empresaId);
  }

  @Areas('comissoes')
  @Delete('comissoes/:id')
  excluirComissao(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.financeiro.excluirComissao(id, user.empresaId);
  }

  // ===== Impostos (estimativa) =====
  @Areas('impostos')
  @Get('impostos')
  impostos(@CurrentUser() user: AuthUser) {
    return this.financeiro.impostos(user.empresaId);
  }
}
