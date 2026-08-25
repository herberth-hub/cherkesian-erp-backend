import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CobrancaService } from './cobranca.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class ConfigDto {
  @IsOptional() @IsBoolean() automatico?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(180) diasAtraso?: number;
  @IsOptional() @IsInt() @Min(1) @Max(180) intervaloDias?: number;
  @IsOptional() @IsString() @Matches(/^\d{2}:\d{2}$/, { message: 'horario deve ser HH:MM.' }) horario?: string;
  @IsOptional() @IsString() @MaxLength(200) copiaPara?: string;
  @IsOptional() @IsString() @MaxLength(500) assinatura?: string;
}

class EnviarDto {
  @IsOptional() @IsArray() @IsInt({ each: true }) clienteIds?: number[];
  @IsOptional() @IsBoolean() force?: boolean;
}

// Área "A Receber" (financeiro/contabilidade/comercial conforme o perfil); admin sempre.
@Areas('receber')
@Controller('financeiro/cobranca')
export class CobrancaController {
  constructor(private readonly service: CobrancaService) {}

  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.empresaId);
  }

  @Post('config')
  saveConfig(@Body() dto: ConfigDto, @CurrentUser() user: AuthUser) {
    return this.service.saveConfig(user.empresaId, dto);
  }

  /** Lista os clientes em atraso (na régua) com títulos e elegibilidade de envio. */
  @Get('pendentes')
  pendentes(@CurrentUser() user: AuthUser) {
    return this.service.pendentes(user.empresaId);
  }

  /** Prévia do e-mail que seria enviado a um cliente. */
  @Get('preview/:clienteId')
  preview(@Param('clienteId', ParseIntPipe) clienteId: number, @CurrentUser() user: AuthUser) {
    return this.service.preview(user.empresaId, clienteId);
  }

  /** Dispara a cobrança (assistido). Sem clienteIds = todos os elegíveis. */
  @Post('enviar')
  enviar(@Body() dto: EnviarDto, @CurrentUser() user: AuthUser) {
    return this.service.enviar(user.empresaId, dto.clienteIds, !!dto.force, false);
  }
}
