import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Comercial (clientes) e Produção (cadastros) enxergam; admin (total) sempre.
@Areas('clientes', 'cadastros')
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.clientesService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.clientesService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateClienteDto, @CurrentUser() user: AuthUser) {
    return this.clientesService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClienteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clientesService.update(id, dto, user.empresaId);
  }
}
