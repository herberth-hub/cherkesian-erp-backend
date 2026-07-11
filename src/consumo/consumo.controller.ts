import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ConsumoService } from './consumo.service';
import { CreateConsumoDto } from './dto/create-consumo.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Receita (BOM) é cadastro de produção; admin sempre.
@Areas('cadastros')
@Controller('consumo')
export class ConsumoController {
  constructor(private readonly consumoService: ConsumoService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('produtoId') produtoId?: string) {
    // parse manual: o ValidationPipe global (implicit conversion) conflita com ParseIntPipe optional
    const id = produtoId ? Number(produtoId) : undefined;
    return this.consumoService.findAll(user.empresaId, Number.isInteger(id) ? id : undefined);
  }

  @Post()
  create(@Body() dto: CreateConsumoDto, @CurrentUser() user: AuthUser) {
    return this.consumoService.create(dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.consumoService.remove(id, user.empresaId);
  }
}
