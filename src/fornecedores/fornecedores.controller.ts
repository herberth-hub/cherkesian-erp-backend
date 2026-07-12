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
import { FornecedoresService } from './fornecedores.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';
import { UpdateFornecedorDto } from './dto/update-fornecedor.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Produção (cadastros/compras); admin (total) sempre.
@Areas('cadastros', 'compras')
@Controller('fornecedores')
export class FornecedoresController {
  constructor(private readonly fornecedoresService: FornecedoresService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.fornecedoresService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateFornecedorDto, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFornecedorDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fornecedoresService.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.fornecedoresService.remove(id, user.empresaId);
  }
}
