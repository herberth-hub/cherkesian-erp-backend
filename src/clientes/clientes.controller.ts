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
  Query,
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
    return this.clientesService.findAll(user.empresaId, user);
  }

  /**
   * Completa o cadastro fiscal do cliente pelo CNPJ dele (endereço, município,
   * código IBGE, CEP). Sem isso a NF-e não sai. `?sobrescrever=1` força por cima
   * do que já existe; o padrão só preenche o que está vazio.
   */
  @Post(':id/completar-fiscal')
  @HttpCode(HttpStatus.OK)
  completarFiscal(
    @Param('id', ParseIntPipe) id: number,
    @Query('sobrescrever') sobrescrever: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clientesService.completarFiscal(id, user.empresaId, sobrescrever === '1' || sobrescrever === 'true');
  }

  /** Cadastro de representantes: carteira de clientes por representante + ranking. */
  @Get('representantes')
  representantes(@CurrentUser() user: AuthUser) {
    return this.clientesService.representantes(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.clientesService.findOne(id, user.empresaId, user);
  }

  /** Ficha do cliente: orçamentos, pedidos e NFs (quantidades + valores). */
  @Get(':id/resumo')
  resumo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.clientesService.resumo(id, user.empresaId, user.acesso);
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

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.clientesService.remove(id, user.empresaId);
  }
}
