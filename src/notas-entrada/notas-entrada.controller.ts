import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateNotaEntradaDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.empresaId, user.usuario);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.empresaId);
  }
}
