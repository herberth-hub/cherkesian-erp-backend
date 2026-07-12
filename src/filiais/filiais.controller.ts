import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { FiliaisService } from './filiais.service';
import { CreateFilialDto } from './dto/create-filial.dto';
import { UpdateFilialDto } from './dto/update-filial.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Leitura liberada aos perfis que criam pedido/OP/NF (para o seletor de filial);
// escrita (cadastro fiscal) é administrativa — método-nível @Areas('usuarios').
@Areas('vendas', 'pcp', 'producao', 'expedicao', 'usuarios')
@Controller('filiais')
export class FiliaisController {
  constructor(private readonly filiaisService: FiliaisService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.filiaisService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.filiaisService.findOne(id, user.empresaId);
  }

  @Areas('usuarios')
  @Post()
  create(@Body() dto: CreateFilialDto, @CurrentUser() user: AuthUser) {
    return this.filiaisService.create(dto, user.empresaId);
  }

  @Areas('usuarios')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFilialDto, @CurrentUser() user: AuthUser) {
    return this.filiaisService.update(id, dto, user.empresaId);
  }

  @Areas('usuarios')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.filiaisService.remove(id, user.empresaId);
  }
}
