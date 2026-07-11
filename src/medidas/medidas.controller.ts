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
import { MedidasService } from './medidas.service';
import { CreateMedidaDto } from './dto/create-medida.dto';
import { UpdateMedidaDto } from './dto/update-medida.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Área 'medidas': comercial e produção enxergam; admin sempre.
@Areas('medidas')
@Controller('medidas')
export class MedidasController {
  constructor(private readonly medidasService: MedidasService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    // parse manual: o ValidationPipe global (implicit conversion) conflita com ParseIntPipe optional
    const id = clienteId ? Number(clienteId) : undefined;
    return this.medidasService.findAll(user.empresaId, Number.isInteger(id) ? id : undefined);
  }

  @Post()
  create(@Body() dto: CreateMedidaDto, @CurrentUser() user: AuthUser) {
    return this.medidasService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMedidaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.medidasService.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.medidasService.remove(id, user.empresaId);
  }
}
