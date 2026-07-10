import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PilotosService } from './pilotos.service';
import { CreatePilotoDto } from './dto/create-piloto.dto';
import { UpdatePilotoDto } from './dto/update-piloto.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Área "piloto": produção e chão de fábrica; admin sempre.
@Areas('piloto')
@Controller('pilotos')
export class PilotosController {
  constructor(private readonly pilotosService: PilotosService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.pilotosService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pilotosService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreatePilotoDto, @CurrentUser() user: AuthUser) {
    return this.pilotosService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePilotoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pilotosService.update(id, dto, user.empresaId);
  }

  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  aprovar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pilotosService.aprovar(id, user.empresaId);
  }
}
