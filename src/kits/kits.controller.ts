import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Ip, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { KitsService } from './kits.service';
import { AlterarLoteKitDto, AtribuirCaixaDto, BiparKitDto, CreateLoteDto, CriarKitsDeOpDto, ExpedirKitDto, RetornarKitDto } from './dto/kits.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('kits')
export class KitsController {
  constructor(private readonly kits: KitsService) {}

  // ===== Lotes de tecido =====
  @Areas('pcp', 'producao', 'estoque', 'compras')
  @Get('lotes')
  listarLotes(@CurrentUser() u: AuthUser) {
    return this.kits.listarLotes(u.empresaId);
  }

  @Areas('pcp', 'producao', 'estoque', 'compras')
  @Post('lotes')
  criarLote(@Body() dto: CreateLoteDto, @CurrentUser() u: AuthUser) {
    return this.kits.criarLote(dto, u.empresaId, u.usuario);
  }

  @Areas('pcp', 'producao', 'estoque')
  @Get('lotes/:codigo/rastreio')
  porLote(@Param('codigo') codigo: string, @CurrentUser() u: AuthUser) {
    return this.kits.porLote(u.empresaId, codigo);
  }

  // ===== Kits =====
  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Get()
  listar(@Query('status') status: string, @CurrentUser() u: AuthUser) {
    return this.kits.listar(u.empresaId, status);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser) {
    return this.kits.dashboard(u.empresaId);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Get('por-caixa')
  porCaixa(@CurrentUser() u: AuthUser) {
    return this.kits.porCaixa(u.empresaId);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Post('atribuir-caixa')
  @HttpCode(HttpStatus.OK)
  atribuirCaixa(@Body() dto: AtribuirCaixaDto, @CurrentUser() u: AuthUser) {
    return this.kits.atribuirCaixa(dto, u.empresaId, u.usuario);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Get('buscar')
  buscar(@Query('q') q: string, @CurrentUser() u: AuthUser) {
    return this.kits.buscar(u.empresaId, q);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Get(':id')
  detalhe(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.kits.detalhe(id, u.empresaId);
  }

  @Areas('pcp', 'producao', 'estoque')
  @Get(':id/etiqueta')
  etiqueta(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    return this.kits.etiqueta(id, u.empresaId);
  }

  /** Cortador finaliza o corte: gera os kits (um por tamanho) da OP. */
  @Areas('pcp', 'producao')
  @Post('gerar-da-op')
  @HttpCode(HttpStatus.CREATED)
  criarDeOp(@Body() dto: CriarKitsDeOpDto, @CurrentUser() u: AuthUser) {
    return this.kits.criarDeOp(dto, u.empresaId, u.usuario);
  }

  @Areas('expedicao', 'pcp', 'producao', 'estoque')
  @Post('expedir')
  @HttpCode(HttpStatus.OK)
  expedir(@Body() dto: ExpedirKitDto, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    return this.kits.expedir(dto, u.empresaId, u.usuario, ip);
  }

  @Areas('expedicao', 'pcp', 'producao', 'estoque')
  @Post('retornar')
  @HttpCode(HttpStatus.OK)
  retornar(@Body() dto: RetornarKitDto, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    return this.kits.retornar(dto, u.empresaId, u.usuario, ip);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Post('conferir')
  @HttpCode(HttpStatus.OK)
  conferir(@Body() dto: BiparKitDto, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    return this.kits.avancar(dto, u.empresaId, 'em_conferencia', u.usuario, ip);
  }

  @Areas('pcp', 'producao', 'expedicao', 'estoque')
  @Post('finalizar')
  @HttpCode(HttpStatus.OK)
  finalizar(@Body() dto: BiparKitDto, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    return this.kits.avancar(dto, u.empresaId, 'finalizado', u.usuario, ip);
  }

  /** Alteração de lote — auditada; só admin (perfil total). */
  @Areas('pcp', 'producao')
  @Post(':id/alterar-lote')
  @HttpCode(HttpStatus.OK)
  alterarLote(@Param('id', ParseIntPipe) id: number, @Body() dto: AlterarLoteKitDto, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    if (u.acesso !== 'total') throw new ForbiddenException('Apenas o administrador pode alterar o lote do tecido de um kit.');
    return this.kits.alterarLote(id, dto, u.empresaId, u.usuario, ip);
  }
}
