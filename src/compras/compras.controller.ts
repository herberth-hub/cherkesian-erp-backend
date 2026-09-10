import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
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

  /** Materiais abaixo do mínimo (ponto de reposição) — sugestão só-leitura.
   *  Declarado ANTES de ':id' p/ não ser capturado pelo ParseIntPipe. */
  @Get('sugestoes-reposicao')
  sugestoesReposicao(@CurrentUser() user: AuthUser) {
    return this.comprasService.sugestoesReposicao(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.comprasService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateOrdemCompraDto, @CurrentUser() user: AuthUser) {
    return this.comprasService.create(dto, user.empresaId);
  }

  /** Gera OCs sugeridas do tecido/insumo faltante (demanda em aberto x estoque). */
  @Post('sugerir-tecido')
  @HttpCode(HttpStatus.CREATED)
  sugerirTecido(@CurrentUser() user: AuthUser) {
    return this.comprasService.sugerirCompraTecido(user.empresaId);
  }

  /** Gera as OCs de reposição selecionadas/ajustadas pelo usuário. */
  @Post('reposicao')
  @HttpCode(HttpStatus.CREATED)
  gerarReposicao(@Body() body: { itens: Array<{ materialId: number; quantidade: number; fornecedorId?: number }> }, @CurrentUser() user: AuthUser) {
    return this.comprasService.gerarReposicao(user.empresaId, body?.itens ?? []);
  }

  @Post(':id/receber')
  @HttpCode(HttpStatus.OK)
  receber(
    @Param('id', ParseIntPipe) id: number,
    @Query('force') force: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comprasService.receber(id, user.empresaId, force === 'true' || force === '1');
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.comprasService.cancelar(id, user.empresaId);
  }
}
