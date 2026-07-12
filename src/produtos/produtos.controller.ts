import {
  Body,
  Controller,
  Delete,
  Get,
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
