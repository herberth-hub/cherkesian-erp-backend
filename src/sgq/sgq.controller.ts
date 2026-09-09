import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { SgqService } from './sgq.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// LEITURA (Universidade/IT): todo perfil interno enxerga (tem ao menos uma destas áreas).
// EDIÇÃO (manual/docs): só administrador (área 'usuarios').
@Controller('sgq')
export class SgqController {
  constructor(private readonly sgq: SgqService) {}

  @Areas('dashboard', 'tv', 'producao', 'estoque', 'expedicao', 'vendas', 'rh', 'pcp', 'usuarios')
  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.sgq.overview(user.empresaId, user.usuario);
  }

  @Areas('usuarios')
  @Put('manual')
  salvarManual(@Body() manual: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.sgq.salvarManual(user.empresaId, manual, user.usuario);
  }

  @Areas('usuarios')
  @Post('doc')
  @HttpCode(HttpStatus.OK)
  salvarDoc(
    @Body() dto: { id?: number; tipo?: string; codigo: string; titulo: string; setor?: string; conteudo?: string; videoUrl?: string; clausulaIso?: string; pontos?: number; ordem?: number; revisao?: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.sgq.salvarDoc(user.empresaId, dto);
  }

  @Areas('usuarios')
  @Delete('doc/:id')
  removerDoc(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.sgq.removerDoc(user.empresaId, id);
  }

  @Areas('dashboard', 'tv', 'producao', 'estoque', 'expedicao', 'vendas', 'rh', 'pcp', 'usuarios')
  @Post('doc/:id/concluir')
  @HttpCode(HttpStatus.OK)
  concluir(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.sgq.concluir(user.empresaId, user.usuario, id);
  }

  @Areas('dashboard', 'tv', 'producao', 'estoque', 'expedicao', 'vendas', 'rh', 'pcp', 'usuarios')
  @Post('doc/:id/desmarcar')
  @HttpCode(HttpStatus.OK)
  desmarcar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.sgq.desmarcar(user.empresaId, user.usuario, id);
  }

  @Areas('dashboard', 'tv', 'producao', 'estoque', 'expedicao', 'vendas', 'rh', 'pcp', 'usuarios')
  @Get('doc/:id/imprimir')
  imprimirIt(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.sgq.imprimirIt(user.empresaId, id);
  }
}
