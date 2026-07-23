import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
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

class CancelarNfeDto {
  @IsString() @MinLength(15, { message: 'A justificativa deve ter ao menos 15 caracteres.' }) @MaxLength(255)
  justificativa!: string;
}

class CartaCorrecaoDto {
  @IsString() @MinLength(15, { message: 'A correção deve ter ao menos 15 caracteres.' }) @MaxLength(1000)
  correcao!: string;
}

class EnviarNfeEmailDto {
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
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

  /** Cancela a NF-e na SEFAZ (nota autorizada, dentro do prazo legal). */
  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelarNfeDto, @CurrentUser() user: AuthUser) {
    return this.nfeService.cancelar(id, user.empresaId, dto.justificativa, user.usuario);
  }

  /** Carta de Correção Eletrônica (CC-e) para uma nota autorizada. */
  @Post(':id/carta-correcao')
  @HttpCode(HttpStatus.OK)
  cartaCorrecao(@Param('id', ParseIntPipe) id: number, @Body() dto: CartaCorrecaoDto, @CurrentUser() user: AuthUser) {
    return this.nfeService.cartaCorrecao(id, user.empresaId, dto.correcao, user.usuario);
  }

  /** Envia a NF (DANFE + XML) por e-mail ao cliente. */
  @Post(':id/email')
  @Areas('vendas', 'expedicao', 'receber')
  @HttpCode(HttpStatus.OK)
  enviarEmail(@Param('id', ParseIntPipe) id: number, @Body() dto: EnviarNfeEmailDto, @CurrentUser() user: AuthUser) {
    return this.nfeService.enviarPorEmail(id, user.empresaId, dto.email);
  }

  /** Exclui o registro de uma nota NÃO autorizada e devolve o número sequencial. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  excluir(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.nfeService.excluir(id, user.empresaId);
  }
}
