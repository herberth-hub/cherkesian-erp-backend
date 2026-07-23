import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { IsInt, IsPositive } from 'class-validator';
import { NfeService } from './nfe.service';
import { CreateNfeAvulsaDto } from './dto/create-nfe-avulsa.dto';
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

  /** NF-e avulsa: cliente + itens, sem expedição. Comercial também emite. */
  @Post('avulsa')
  @Areas('vendas', 'expedicao', 'receber')
  @HttpCode(HttpStatus.CREATED)
  avulsa(@Body() dto: CreateNfeAvulsaDto, @CurrentUser() user: AuthUser) {
    return this.nfeService.emitirAvulsa(dto, user.empresaId, user.usuario);
  }

  /** Consulta na SEFAZ (via Focus) e atualiza o status/chave/protocolo da nota. */
  @Post(':id/consultar')
  @HttpCode(HttpStatus.OK)
  consultar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.nfeService.consultar(id, user.empresaId);
  }
}
