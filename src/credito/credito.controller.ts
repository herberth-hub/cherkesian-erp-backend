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
import { IsInt, IsOptional, IsBoolean, IsPositive } from 'class-validator';
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

// Comercial consulta; a liberação (override) é só do admin (checado no método).
@Areas('clientes', 'vendas')
@Controller('credito')
export class CreditoController {
  constructor(private readonly credito: CreditoService) {}

  @Post('consultar')
  consultar(@Body() dto: ConsultarDto, @CurrentUser() user: AuthUser) {
    return this.credito.consultar(dto.clienteId, user.empresaId, user.usuario);
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
