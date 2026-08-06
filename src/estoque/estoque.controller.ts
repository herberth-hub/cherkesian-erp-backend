import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Query } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { MovimentarEstoqueDto } from './dto/movimentar.dto';
import { EntradaEstoqueDto, EnderecarDto } from './dto/unidade.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('estoque')
@Controller('estoque')
export class EstoqueController {
  constructor(private readonly estoqueService: EstoqueService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.estoqueService.findAll(user.empresaId);
  }

  // ===== Estoque unitário (etiqueta por peça + endereçamento) =====
  @Areas('estoque', 'producao', 'expedicao')
  @Get('unidades')
  unidades(@Query('status') status: string, @Query('q') q: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.listarUnidades(user.empresaId, status, q);
  }

  @Areas('estoque', 'producao', 'compras')
  @Post('entrada')
  @HttpCode(HttpStatus.CREATED)
  entrada(@Body() dto: EntradaEstoqueDto, @CurrentUser() user: AuthUser) {
    return this.estoqueService.entrada(dto, user.empresaId, user.usuario);
  }

  @Areas('estoque', 'producao', 'expedicao')
  @Post('unidades/etiquetas')
  @HttpCode(HttpStatus.OK)
  etiquetasUnidades(@Body() body: { codigos: string[] }, @CurrentUser() user: AuthUser) {
    return this.estoqueService.etiquetasUnidades(body?.codigos ?? [], user.empresaId);
  }

  /** Reimprime as etiquetas de todas as unidades de um lote (ex.: OP-123). */
  @Areas('estoque', 'producao', 'expedicao')
  @Get('lote/:lote/etiquetas')
  etiquetasPorLote(@Param('lote') lote: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.etiquetasPorLote(lote, user.empresaId);
  }

  @Areas('estoque', 'producao', 'expedicao')
  @Get('unidade/:codigo')
  consultarUnidade(@Param('codigo') codigo: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.consultarUnidade(codigo, user.empresaId);
  }

  @Areas('estoque', 'producao')
  @Delete('unidade/:codigo')
  excluirUnidade(@Param('codigo') codigo: string, @CurrentUser() user: AuthUser) {
    if (user.acesso !== 'total') {
      throw new ForbiddenException('Apenas o administrador da conta pode excluir etiquetas.');
    }
    return this.estoqueService.excluirUnidade(codigo, user.empresaId);
  }

  /** Exclusão em massa (admin) de unidades selecionadas. */
  @Areas('estoque', 'producao')
  @Post('unidades/excluir')
  @HttpCode(HttpStatus.OK)
  excluirUnidades(@Body() body: { codigos: string[] }, @CurrentUser() user: AuthUser) {
    if (user.acesso !== 'total') {
      throw new ForbiddenException('Apenas o administrador da conta pode excluir etiquetas.');
    }
    return this.estoqueService.excluirUnidades(body?.codigos ?? [], user.empresaId);
  }

  @Areas('estoque', 'producao')
  @Post('enderecar')
  @HttpCode(HttpStatus.OK)
  enderecar(@Body() dto: EnderecarDto, @CurrentUser() user: AuthUser) {
    return this.estoqueService.enderecar(dto, user.empresaId, user.usuario);
  }

  // ===== Quarentena (anomalia / estorno de cliente) =====
  @Areas('estoque', 'producao', 'expedicao')
  @Post('quarentena')
  @HttpCode(HttpStatus.OK)
  enviarQuarentena(@Body() body: { codigo: string; motivo?: string }, @CurrentUser() user: AuthUser) {
    return this.estoqueService.enviarQuarentena(body?.codigo ?? '', body?.motivo ?? '', user.empresaId);
  }

  @Areas('estoque', 'producao')
  @Post('quarentena/resolver')
  @HttpCode(HttpStatus.OK)
  resolverQuarentena(@Body() body: { codigo: string; destino?: string }, @CurrentUser() user: AuthUser) {
    return this.estoqueService.resolverQuarentena(body?.codigo ?? '', body?.destino ?? 'recebimento', user.empresaId);
  }

  // ===== Caixas master (etiqueta p/ colar + leitura do conteúdo) =====
  @Areas('estoque', 'producao')
  @Get('caixas/etiquetas')
  etiquetasCaixas(@Query('nums') nums: string, @Query('base') base: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.etiquetasCaixas(user.empresaId, nums, base);
  }

  @Areas('estoque', 'producao', 'expedicao')
  @Get('caixa/:codigo')
  conteudoCaixa(@Param('codigo') codigo: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.conteudoCaixa(codigo, user.empresaId);
  }

  @Get(':codigo/lotes')
  lotes(@Param('codigo') codigo: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.lotesPorCodigo(codigo, user.empresaId);
  }

  @Post('movimentar')
  @HttpCode(HttpStatus.OK)
  movimentar(@Body() dto: MovimentarEstoqueDto, @CurrentUser() user: AuthUser) {
    return this.estoqueService.movimentar(dto, user.empresaId);
  }
}
