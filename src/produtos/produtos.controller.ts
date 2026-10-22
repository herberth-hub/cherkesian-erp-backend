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
import { ProdutosService } from './produtos.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { AtualizarCorProdutoDto, CorProdutoDto } from './dto/cor-produto.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Produção (cadastros) e Comercial (vendas, p/ montar pedidos); admin sempre.
@Areas('cadastros', 'vendas')
@Controller('produtos')
export class ProdutosController {
  constructor(private readonly produtosService: ProdutosService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.produtosService.findAll(user.empresaId);
  }

  /**
   * Fotos de VÁRIOS produtos, em lote, para a galeria do catálogo.
   *
   * A lista (`GET /produtos`) omite os base64 de propósito: 221 produtos × ~100 KB
   * de foto seriam ~22 MB a cada abertura da tela. A galeria pede só as fotos dos
   * cards que apareceram na rolagem, em blocos, e guarda o que já recebeu.
   */
  @Post('fotos')
  @HttpCode(HttpStatus.OK)
  fotos(@Body() body: { ids?: number[] }, @CurrentUser() user: AuthUser) {
    return this.produtosService.fotos(body?.ids ?? [], user.empresaId);
  }

  /** Mockups de várias cores, em lote — mesma razão de `POST /produtos/fotos`. */
  @Post('cores/mockups')
  @HttpCode(HttpStatus.OK)
  mockups(@Body() body: { ids?: number[] }, @CurrentUser() user: AuthUser) {
    return this.produtosService.mockups(body?.ids ?? [], user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.produtosService.findOne(id, user.empresaId);
  }

  // ---------- Cores do produto (cada uma com o seu mockup) ----------

  /** `?mockup=1` traz os base64; sem isso vem só nome, hex e ordem. */
  @Get(':id/cores')
  cores(
    @Param('id', ParseIntPipe) id: number,
    @Query('mockup') mockup: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.produtosService.cores(id, user.empresaId, mockup === '1' || mockup === 'true');
  }

  @Post(':id/cores')
  criarCor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CorProdutoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.produtosService.criarCor(id, user.empresaId, dto);
  }

  @Patch(':id/cores/:corId')
  atualizarCor(
    @Param('id', ParseIntPipe) id: number,
    @Param('corId', ParseIntPipe) corId: number,
    @Body() dto: AtualizarCorProdutoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.produtosService.atualizarCor(id, corId, user.empresaId, dto);
  }

  @Delete(':id/cores/:corId')
  removerCor(
    @Param('id', ParseIntPipe) id: number,
    @Param('corId', ParseIntPipe) corId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.produtosService.removerCor(id, corId, user.empresaId);
  }

  /** Ficha de custo (BOM × custo do material) — base da precificação. */
  @Get(':id/custo')
  custo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.produtosService.custo(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateProdutoDto, @CurrentUser() user: AuthUser) {
    return this.produtosService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProdutoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.produtosService.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.produtosService.remove(id, user.empresaId);
  }
}
