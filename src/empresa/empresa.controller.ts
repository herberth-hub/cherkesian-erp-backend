import { Body, Controller, Get, Patch } from '@nestjs/common';
import { EmpresaService } from './empresa.service';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Configuração fiscal da empresa é área administrativa (perfil total).
@Areas('usuarios')
@Controller('empresa')
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.empresaService.get(user.empresaId);
  }

  @Get('prontidao-fiscal')
  prontidao(@CurrentUser() user: AuthUser) {
    return this.empresaService.prontidaoFiscal(user.empresaId);
  }

  @Patch()
  update(@Body() dto: UpdateEmpresaDto, @CurrentUser() user: AuthUser) {
    return this.empresaService.update(user.empresaId, dto);
  }
}
