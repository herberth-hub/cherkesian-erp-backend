import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
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

  // ===== PCT — Plano de Controle de Teste (admin) =====
  @Get('pct')
  pctGet(@CurrentUser() user: AuthUser) {
    return this.empresaService.pctGet(user.empresaId);
  }

  @Post('pct/ativo')
  @HttpCode(HttpStatus.OK)
  pctAtivo(@Body('ativo') ativo: boolean, @CurrentUser() user: AuthUser) {
    return this.empresaService.pctSetAtivo(user.empresaId, !!ativo);
  }

  @Post('pct/teste')
  @HttpCode(HttpStatus.OK)
  pctAddTeste(@Body() dto: { funcionalidade: string; status: string; obs?: string }, @CurrentUser() user: AuthUser) {
    return this.empresaService.pctAddTeste(user.empresaId, dto, user.usuario);
  }

  @Delete('pct/teste/:id')
  pctDelTeste(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.empresaService.pctDelTeste(user.empresaId, id);
  }

  @Get('diagnostico')
  diagnostico(@CurrentUser() user: AuthUser) {
    return this.empresaService.diagnosticoGaps(user.empresaId);
  }

  @Post('testar-email')
  @HttpCode(HttpStatus.OK)
  testarEmail(@Body('para') para: string, @CurrentUser() user: AuthUser) {
    return this.empresaService.testarEmail(user.empresaId, para, user.usuario);
  }
}
