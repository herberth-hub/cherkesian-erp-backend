import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ExtratoService } from './extrato.service';
import { ImportarExtratoDto, ConciliarDto, IgnorarDto } from './extrato.dto';
import { Areas } from '../../common/decorators/acesso.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../auth/auth.types';

/**
 * EXTRATO BANCÁRIO ESPELHADO + conciliação.
 *
 * Mexe em dinheiro (dá baixa em título), então fica atrás das áreas do
 * financeiro — quem só emite nota ou movimenta estoque não concilia banco.
 */
@Areas('receber', 'pagar', 'fluxo')
@Controller('bancos/extrato')
export class ExtratoController {
  constructor(private readonly extrato: ExtratoService) {}

  /** Placar: quanto do extrato o sistema já sabe explicar. */
  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser, @Query('conta') conta?: string) {
    return this.extrato.resumo(user.empresaId, conta ? Number(conta) : undefined);
  }

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @Query('conta') conta?: string,
    @Query('status') status?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.extrato.listar(user.empresaId, {
      contaBancariaId: conta ? Number(conta) : undefined,
      status, de, ate,
    });
  }

  /** Sobe o OFX baixado do internet banking. */
  @Post('importar')
  @HttpCode(HttpStatus.OK)
  importar(@Body() dto: ImportarExtratoDto, @CurrentUser() user: AuthUser) {
    return this.extrato.importar(dto, user.empresaId, user.usuario);
  }

  /** Títulos que podem ser este lançamento, do mais provável ao menos. */
  @Get(':id/sugestoes')
  sugestoes(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.extrato.sugestoes(id, user.empresaId);
  }

  /** Liga o lançamento ao título E dá a baixa. */
  @Post(':id/conciliar')
  @HttpCode(HttpStatus.OK)
  conciliar(@Param('id', ParseIntPipe) id: number, @Body() dto: ConciliarDto, @CurrentUser() user: AuthUser) {
    return this.extrato.conciliar(id, dto, user.empresaId, user.usuario);
  }

  /** Solta o lançamento do título. A baixa NÃO é estornada aqui. */
  @Post(':id/desconciliar')
  @HttpCode(HttpStatus.OK)
  desconciliar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.extrato.desconciliar(id, user.empresaId, user.usuario);
  }

  /** "Não é título" — tarifa, IOF, transferência entre contas próprias. */
  @Post(':id/ignorar')
  @HttpCode(HttpStatus.OK)
  ignorar(@Param('id', ParseIntPipe) id: number, @Body() dto: IgnorarDto, @CurrentUser() user: AuthUser) {
    return this.extrato.ignorar(id, dto.motivo ?? '', user.empresaId, user.usuario);
  }
}
