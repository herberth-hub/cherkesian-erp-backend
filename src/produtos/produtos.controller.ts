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
} from '@nestjs/common';
import { ProdutosService } from './produtos.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.produtosService.findOne(id, user.empresaId);
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
