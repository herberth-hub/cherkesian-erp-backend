import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { RetalhosService } from './retalhos.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class CriarRetalhoDto {
  @IsOptional() @IsString() @MaxLength(120) descricao?: string;
  @IsOptional() @IsString() @MaxLength(60) cor?: string;
  @IsOptional() @IsString() @MaxLength(120) composicao?: string;
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'pesoKg deve ter no máximo 3 casas.' })
  @IsPositive({ message: 'Informe o peso (kg > 0).' })
  pesoKg!: number;
  @IsOptional() @IsString() @MaxLength(60) localizacao?: string;
  @IsOptional() @IsString() @MaxLength(60) origem?: string;
  @IsOptional() @IsInt() @Min(1) filialId?: number;
}

class ReciclarDto {
  @IsOptional() @IsArray() @IsInt({ each: true }) ids?: number[];
}

@Areas('estoque', 'producao')
@Controller('retalhos')
export class RetalhosController {
  constructor(private readonly service: RetalhosService) {}

  @Get()
  findAll(@Query('todos') todos: string, @CurrentUser() user: AuthUser) {
    return this.service.findAll(user.empresaId, todos === 'true' || todos === '1');
  }

  @Post()
  create(@Body() dto: CriarRetalhoDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.empresaId, user.usuario);
  }

  @Post('reciclar')
  reciclar(@Body() dto: ReciclarDto, @CurrentUser() user: AuthUser) {
    return this.service.reciclar(user.empresaId, dto.ids);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.empresaId);
  }
}
