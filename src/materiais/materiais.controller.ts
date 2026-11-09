import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MateriaisService } from './materiais.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Produção (cadastros/estoque/compras); admin sempre.
@Areas('cadastros', 'estoque', 'compras')
@Controller('materiais')
export class MateriaisController {
  constructor(private readonly materiaisService: MateriaisService) {}

  /**
   * Lista os materiais ATIVOS. `?inativos=1` traz também os inativos — é o que a
   * tela de cadastro usa, para mostrar o inativo com selo e dar para reativar.
   * As telas que OFERECEM material chamam sem o parâmetro e nunca veem cadastro
   * morto.
   */
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('inativos') inativos?: string) {
    const incluir = inativos === '1' || inativos === 'true';
    return this.materiaisService.findAll(user.empresaId, incluir);
  }

  @Get('abaixo-minimo')
  abaixoDoMinimo(@CurrentUser() user: AuthUser) {
    return this.materiaisService.abaixoDoMinimo(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.materiaisService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateMaterialDto, @CurrentUser() user: AuthUser) {
    return this.materiaisService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMaterialDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.materiaisService.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.materiaisService.remove(id, user.empresaId);
  }
}
