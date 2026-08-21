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
import { NotasEntradaService } from './notas-entrada.service';
import { CreateNotaEntradaDto } from './dto/create-nota-entrada.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Compras cuida da entrada de mercadoria; admin sempre.
@Areas('compras')
@Controller('notas-entrada')
export class NotasEntradaController {
  constructor(private readonly service: NotasEntradaService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.empresaId);
  }

  /** Rastreador SEFAZ: NF-e emitidas contra o CNPJ (declarado antes de :id). */
  @Get('sefaz')
  sefaz(@CurrentUser() user: AuthUser) {
    return this.service.sefazListar(user.empresaId);
  }

  @Get('sefaz/:chave')
  sefazDetalhe(@Param('chave') chave: string, @CurrentUser() user: AuthUser) {
    return this.service.sefazDetalhe(user.empresaId, chave);
  }

  /** Rastreador de CT-es (fretes) emitidos contra o CNPJ. */
  @Get('ctes')
  ctes(@CurrentUser() user: AuthUser) {
    return this.service.ctesListar(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateNotaEntradaDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.empresaId, user.usuario);
  }

  /** Edita a NF de entrada: recalcula valor, estorna+relança estoque, reabre+re-baixa
   *  as OCs e ajusta o título a pagar vinculado (se ainda não pago). */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNotaEntradaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.empresaId);
  }

  /** Marca que as etiquetas de volume (rolos) já foram emitidas para esta NF. */
  @Post(':id/etiquetas-geradas')
  @HttpCode(HttpStatus.OK)
  marcarEtiquetas(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.marcarEtiquetasGeradas(id, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.empresaId);
  }
}
