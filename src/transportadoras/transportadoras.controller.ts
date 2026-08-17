import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { TransportadorasService } from './transportadoras.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class TransportadoraDto {
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MaxLength(20) cnpjCpf?: string;
  @IsOptional() @IsString() @MaxLength(20) inscricaoEstadual?: string;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string;
  @IsOptional() @IsString() @MaxLength(120) logradouro?: string;
  @IsOptional() @IsString() @MaxLength(20) numeroEndereco?: string;
  @IsOptional() @IsString() @MaxLength(60) bairro?: string;
  @IsOptional() @IsString() @MaxLength(60) municipio?: string;
  @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @IsOptional() @IsString() @MaxLength(10) cep?: string;
  @IsOptional() @IsString() @MaxLength(10) placaVeiculo?: string;
  @IsOptional() @IsString() @MaxLength(2) ufVeiculo?: string;
  @IsOptional() @IsString() @MaxLength(20) rntc?: string;
  @IsOptional() @IsBoolean() ativa?: boolean;
}

// Expedição/vendas emitem NF (usam a transportadora); usuarios administra o cadastro.
@Areas('expedicao', 'vendas', 'usuarios')
@Controller('transportadoras')
export class TransportadorasController {
  constructor(private readonly service: TransportadorasService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.empresaId);
  }

  @Post()
  create(@Body() dto: TransportadoraDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: TransportadoraDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.empresaId);
  }
}
