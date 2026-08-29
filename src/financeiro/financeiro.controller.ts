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
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { TituloStatus } from '@prisma/client';
import { ContasReceberService } from './contas-receber.service';
import { ContasPagarService } from './contas-pagar.service';
import { ContasRecorrentesService } from './contas-recorrentes.service';
import { CreateContaRecorrenteDto } from './dto/create-conta-recorrente.dto';
import { FinanceiroService } from './financeiro.service';
import { CreateContaReceberDto } from './dto/create-conta-receber.dto';
import { CreateContaPagarDto } from './dto/create-conta-pagar.dto';
import { CreateComissaoDto } from './dto/create-comissao.dto';
import { UpdateComissaoDto } from './dto/update-comissao.dto';
import { UpdateContaReceberDto } from './dto/update-conta-receber.dto';
import { UpdateContaPagarDto } from './dto/update-conta-pagar.dto';
import { BaixarDto } from './dto/baixar.dto';
import { ParcelarDto } from './dto/parcelar.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('financeiro')
export class FinanceiroController {
  constructor(
    private readonly receber: ContasReceberService,
    private readonly pagar: ContasPagarService,
    private readonly recorrentes: ContasRecorrentesService,
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

  /** Exclusão em lote de títulos a receber (seleção múltipla). */
  @Areas('receber')
  @Post('receber/excluir-lote')
  @HttpCode(HttpStatus.OK)
  excluirReceberLote(@Body() dto: { ids: number[] }, @CurrentUser() user: AuthUser) {
    return this.receber.excluirLote(dto?.ids ?? [], user.empresaId);
  }

  /** Recebimento (quitação total) em lote de títulos a receber. */
  @Areas('receber')
  @Post('receber/baixar-lote')
  @HttpCode(HttpStatus.OK)
  baixarReceberLote(@Body() dto: { ids: number[] }, @CurrentUser() user: AuthUser) {
    return this.receber.baixarLote(dto?.ids ?? [], user.empresaId);
  }

  /** Exclusão em lote de títulos a pagar (seleção múltipla). */
  @Areas('pagar')
  @Post('pagar/excluir-lote')
  @HttpCode(HttpStatus.OK)
  excluirPagarLote(@Body() dto: { ids: number[] }, @CurrentUser() user: AuthUser) {
    return this.pagar.excluirLote(dto?.ids ?? [], user.empresaId);
  }

  /** Baixa (quitação total) em lote de títulos a pagar. */
  @Areas('pagar')
  @Post('pagar/baixar-lote')
  @HttpCode(HttpStatus.OK)
  baixarPagarLote(@Body() dto: { ids: number[]; banco?: string }, @CurrentUser() user: AuthUser) {
    return this.pagar.baixarLote(dto?.ids ?? [], user.empresaId, dto?.banco);
  }

  @Areas('receber')
  @Post('receber/:id/baixar')
  @HttpCode(HttpStatus.OK)
  baixarReceber(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BaixarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receber.baixar(id, user.empresaId, dto.valor, dto.juros);
  }

  @Areas('receber')
  @Patch('receber/:id')
  editarReceber(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContaReceberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receber.editar(id, dto, user.empresaId);
  }

  @Areas('receber')
  @Delete('receber/:id')
  excluirReceber(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.receber.excluir(id, user.empresaId);
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

  /** Visualiza/baixa o boleto (PDF/imagem) anexado ao título a pagar. */
  @Areas('pagar')
  @Get('pagar/:id/boleto')
  async boletoPagar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const a = await this.pagar.getBoleto(id, user.empresaId);
    res.set({ 'Content-Type': a.contentType, 'Content-Disposition': `inline; filename="${a.filename}"` });
    res.send(a.content);
  }

  @Areas('pagar')
  @Post('pagar/:id/baixar')
  @HttpCode(HttpStatus.OK)
  baixarPagar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BaixarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pagar.baixar(id, user.empresaId, dto.valor, dto.banco, dto.juros);
  }

  // ===== Contas recorrentes (aluguel, luz, água, internet…) =====
  @Areas('pagar')
  @Get('recorrentes')
  listarRecorrentes(@CurrentUser() user: AuthUser) {
    return this.recorrentes.findAll(user.empresaId);
  }

  @Areas('pagar')
  @Post('recorrentes')
  criarRecorrente(@Body() dto: CreateContaRecorrenteDto, @CurrentUser() user: AuthUser) {
    return this.recorrentes.create(dto, user.empresaId);
  }

  @Areas('pagar')
  @Patch('recorrentes/:id')
  toggleRecorrente(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { ativa: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.recorrentes.setAtiva(id, user.empresaId, !!body.ativa);
  }

  @Areas('pagar')
  @Delete('recorrentes/:id')
  removerRecorrente(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.recorrentes.remover(id, user.empresaId);
  }

  @Areas('pagar')
  @Post('recorrentes/gerar')
  @HttpCode(HttpStatus.OK)
  gerarRecorrentes(@CurrentUser() user: AuthUser) {
    return this.recorrentes.gerarProximos(user.empresaId, new Date(), 2);
  }

  @Areas('pagar')
  @Post('pagar/:id/parcelar')
  @HttpCode(HttpStatus.OK)
  parcelarPagar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ParcelarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pagar.parcelar(id, user.empresaId, dto.parcelas);
  }

  @Areas('pagar')
  @Patch('pagar/:id')
  editarPagar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContaPagarDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pagar.editar(id, dto, user.empresaId);
  }

  @Areas('pagar')
  @Delete('pagar/:id')
  excluirPagar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pagar.excluir(id, user.empresaId);
  }

  // ===== Fluxo de caixa =====
  @Areas('fluxo')
  @Get('fluxo')
  fluxo(@CurrentUser() user: AuthUser) {
    return this.financeiro.fluxo(user.empresaId);
  }

  @Areas('fluxo')
  @Get('fluxo/calendario')
  calendario(
    @CurrentUser() user: AuthUser,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.financeiro.calendario(user.empresaId, de, ate);
  }

  @Areas('fluxo')
  @Get('fluxo/calendario/xlsx')
  async calendarioXlsx(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    const { buffer, nome } = await this.financeiro.calendarioXlsx(user.empresaId, de, ate);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    res.send(buffer);
  }

  // ===== Comissões (financeiro + comercial) =====
  @Areas('comissoes')
  @Get('comissoes')
  listarComissoes(@CurrentUser() user: AuthUser) {
    return this.financeiro.listarComissoes(user.empresaId, user.acesso === 'vendedor' ? user.nome : undefined);
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
