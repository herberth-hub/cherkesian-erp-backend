import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FornecedoresService } from './fornecedores.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';
import { UpdateFornecedorDto } from './dto/update-fornecedor.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Produção (cadastros/compras); admin (total) sempre.
@Areas('cadastros', 'compras')
@Controller('fornecedores')
export class FornecedoresController {
  constructor(private readonly fornecedoresService: FornecedoresService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.fornecedoresService.findAll(user.empresaId);
  }

  /** Ficha do fornecedor: compras, notas de entrada e contas a pagar. */
  @Get(':id/resumo')
  resumo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.resumo(id, user.empresaId);
  }

  /** Visualiza/baixa o catálogo (PDF/imagem) anexado ao fornecedor. */
  @Get(':id/catalogo')
  async catalogo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const a = await this.fornecedoresService.getCatalogo(id, user.empresaId);
    res.set({ 'Content-Type': a.contentType, 'Content-Disposition': `inline; filename="${a.filename}"` });
    res.send(a.content);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateFornecedorDto, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFornecedorDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fornecedoresService.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.remove(id, user.empresaId);
  }
}
