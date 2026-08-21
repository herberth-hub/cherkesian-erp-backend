import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IsInt, IsOptional, IsBoolean, IsPositive, IsString, IsIn, MaxLength, Min } from 'class-validator';
import { CreditoService } from './credito.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class ConsultarDto {
  @IsInt() @IsPositive() clienteId!: number;
}
class LiberarDto {
  @IsOptional() @IsBoolean() liberar?: boolean;
}
class CreditoConfigDto {
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsOptional() @IsIn(['auto', 'externo', 'brasilapi', 'simulado', 'off']) provedor?: string;
  @IsOptional() @IsString() @MaxLength(500) apiUrl?: string;
  @IsOptional() @IsString() @MaxLength(4000) apiToken?: string;
  @IsOptional() @IsIn(['bearer', 'oauth2', 'none']) authType?: string;
  @IsOptional() @IsString() @MaxLength(500) oauthTokenUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) oauthClientId?: string;
  @IsOptional() @IsString() @MaxLength(4000) oauthClientSecret?: string;
  @IsOptional() @IsString() @MaxLength(200) oauthScope?: string;
  @IsOptional() @IsInt() @Min(0) scoreMin?: number;
  @IsOptional() @IsBoolean() bloqueiaPedido?: boolean;
  @IsOptional() @IsInt() @Min(1) validadeDias?: number;
}
class TestarDto {
  @IsOptional() @IsString() @MaxLength(20) documento?: string;
}

// Comercial consulta; a liberação (override) é só do admin (checado no método).
@Areas('clientes', 'vendas')
@Controller('credito')
export class CreditoController {
  constructor(private readonly credito: CreditoService) {}

  @Post('consultar')
  consultar(@Body() dto: ConsultarDto, @CurrentUser() user: AuthUser) {
    return this.credito.consultar(dto.clienteId, user.empresaId, user.usuario);
  }

  // ===== Configuração da integração (Serasa/parceiro) — só admin =====
  private soAdmin(user: AuthUser) {
    if (user.acesso !== 'total') throw new ForbiddenException('Apenas o administrador pode configurar a consulta de crédito.');
  }

  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.credito.getConfigPublica(user.empresaId);
  }

  @Patch('config')
  saveConfig(@Body() dto: CreditoConfigDto, @CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.credito.saveConfig(user.empresaId, dto as never, user.usuario);
  }

  @Post('testar')
  testar(@Body() dto: TestarDto, @CurrentUser() user: AuthUser) {
    this.soAdmin(user);
    return this.credito.testar(user.empresaId, dto?.documento);
  }

  @Get(':clienteId')
  ultima(@Param('clienteId', ParseIntPipe) clienteId: number) {
    return this.credito.ultimaConsulta(clienteId);
  }

  /** Override do admin: libera o cliente para vender mesmo com restrição. */
  @Patch(':clienteId/liberar')
  liberar(
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Body() dto: LiberarDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (user.acesso !== 'total') {
      throw new ForbiddenException('Apenas o administrador pode liberar o crédito de um cliente.');
    }
    return this.credito.liberar(clienteId, user.empresaId, user.usuario, dto.liberar !== false);
  }
}
