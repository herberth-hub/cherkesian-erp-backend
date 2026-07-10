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
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * CRUD de usuários — área administrativa `usuarios`, que somente o perfil `total`
 * (admin) enxerga. Protegido globalmente por JWT + RBAC + horário comercial.
 */
@Areas('usuarios')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.usuariosService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.usuariosService.findOne(id, user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateUsuarioDto, @CurrentUser() user: AuthUser) {
    return this.usuariosService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUsuarioDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usuariosService.update(id, dto, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.usuariosService.remove(id, user.empresaId);
  }
}
