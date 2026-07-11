import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { IsInt, IsPositive } from 'class-validator';
import { NfeService } from './nfe.service';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class EmitirNfeDto {
  @IsInt()
  @IsPositive()
  expedicaoId!: number;
}

// Expedição emite; financeiro consulta (área 'receber' cobre o perfil financeiro).
@Areas('expedicao', 'receber')
@Controller('nfe')
export class NfeController {
  constructor(private readonly nfeService: NfeService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.nfeService.listar(user.empresaId);
  }

  @Post('emitir')
  @HttpCode(HttpStatus.CREATED)
  emitir(@Body() dto: EmitirNfeDto, @CurrentUser() user: AuthUser) {
    return this.nfeService.emitir(dto.expedicaoId, user.empresaId, user.usuario);
  }
}
