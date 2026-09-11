import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { EngenhariaService } from './engenharia.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('cadastros')
@Controller('engenharia')
export class EngenhariaController {
  constructor(private readonly eng: EngenhariaService) {}

  @Get('mockups')
  listarAssets(@Query('categoria') categoria: string, @Query('tipo') tipo: string, @CurrentUser() user: AuthUser) {
    return this.eng.listarAssets(user.empresaId, categoria || undefined, tipo || undefined);
  }

  @Post('mockups')
  @HttpCode(HttpStatus.OK)
  salvarAsset(@Body() dto: { id?: number; categoria: string; tipoProduto?: string; vista?: string; nome: string; imagem: string; larguraPct?: number; ordem?: number }, @CurrentUser() user: AuthUser) {
    return this.eng.salvarAsset(user.empresaId, dto);
  }

  @Delete('mockups/:id')
  removerAsset(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eng.removerAsset(user.empresaId, id);
  }

  @Get('produto-mockups')
  listarMockups(@Query('produtoId') produtoId: string, @CurrentUser() user: AuthUser) {
    return this.eng.listarMockups(user.empresaId, produtoId ? Number(produtoId) : undefined);
  }

  @Get('produto-mockups/:id')
  obterMockup(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eng.obterMockup(user.empresaId, id);
  }

  @Post('produto-mockups')
  @HttpCode(HttpStatus.OK)
  salvarMockup(@Body() dto: { id?: number; produtoId?: number; nome: string; composicao: Record<string, unknown>; preview?: string }, @CurrentUser() user: AuthUser) {
    return this.eng.salvarMockup(user.empresaId, dto);
  }

  @Delete('produto-mockups/:id')
  removerMockup(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.eng.removerMockup(user.empresaId, id);
  }
}
