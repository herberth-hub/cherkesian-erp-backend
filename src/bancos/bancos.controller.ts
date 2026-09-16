import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { BancosService } from './bancos.service';
import { GerarRemessaDto, ProcessarRetornoDto } from './dto/bancos.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/** Integração bancária — cobrança (contas a receber): remessa, retorno e boleto. */
@Areas('receber')
@Controller('bancos')
export class BancosController {
  constructor(private readonly bancos: BancosService) {}

  @Get('contas')
  contas(@CurrentUser() user: AuthUser) {
    return this.bancos.contas(user.empresaId);
  }

  @Post('remessas')
  gerarRemessa(@Body() dto: GerarRemessaDto, @CurrentUser() user: AuthUser) {
    return this.bancos.gerarRemessa(user.empresaId, user.usuario, dto.contaBancariaId, dto.ids);
  }

  @Get('remessas')
  remessas(@CurrentUser() user: AuthUser, @Query('contaBancariaId') contaBancariaId?: string) {
    return this.bancos.remessas(user.empresaId, contaBancariaId ? Number(contaBancariaId) : undefined);
  }

  /** Download do arquivo .REM (texto ASCII, CRLF) para subir no internet banking. */
  @Get('remessas/:id/arquivo')
  async arquivo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const a = await this.bancos.arquivoRemessa(id, user.empresaId);
    res.set({ 'Content-Type': 'text/plain; charset=latin1', 'Content-Disposition': `attachment; filename="${a.nomeArquivo}"` });
    return new StreamableFile(Buffer.from(a.conteudo, 'latin1'));
  }

  @Post('remessas/:id/enviada')
  enviada(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.bancos.marcarEnviada(id, user.empresaId);
  }

  @Post('retornos')
  retorno(@Body() dto: ProcessarRetornoDto, @CurrentUser() user: AuthUser) {
    return this.bancos.processarRetorno(user.empresaId, user.usuario, dto.contaBancariaId, dto.nomeArquivo, dto.conteudo);
  }

  @Get('retornos')
  retornos(@CurrentUser() user: AuthUser, @Query('contaBancariaId') contaBancariaId?: string) {
    return this.bancos.retornos(user.empresaId, contaBancariaId ? Number(contaBancariaId) : undefined);
  }

  /** Boleto vigente de cada título (?ids=1,2,3). */
  @Get('boletos')
  boletos(@CurrentUser() user: AuthUser, @Query('ids') ids?: string) {
    const list = String(ids || '').split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
    return list.length ? this.bancos.boletosPorTitulo(user.empresaId, list) : {};
  }

  @Get('boletos/:contaReceberId/pdf')
  async pdf(@Param('contaReceberId', ParseIntPipe) contaReceberId: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const a = await this.bancos.boletoPdf(contaReceberId, user.empresaId);
    res.set({ 'Content-Type': a.contentType, 'Content-Disposition': `inline; filename="${a.filename}"` });
    return new StreamableFile(a.content);
  }
}
