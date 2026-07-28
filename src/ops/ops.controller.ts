import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OpsService } from './ops.service';
import { UpdateOpGradeDto, UpdateOpProgressoDto, UpdateOpStatusDto } from './dto/update-op.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('pcp', 'producao')
@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.opsService.findAll(user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.opsService.findOne(id, user.empresaId);
  }

  /** Romaneio de corte: materiais a separar para a OP (com status de conferência). */
  @Areas('pcp', 'producao', 'estoque')
  @Get(':id/romaneio')
  romaneio(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.opsService.romaneio(id, user.empresaId);
  }

  /** Dupla conferência do estoquista: bipa o material/rolo do romaneio (não baixa saldo). */
  @Areas('pcp', 'producao', 'estoque')
  @Post(':id/conferir-material')
  @HttpCode(HttpStatus.OK)
  conferirMaterial(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { codigo: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.conferirMaterial(id, body?.codigo ?? '', user.empresaId, user.usuario);
  }

  /** Reserva manual de lotes do fornecedor por material (rastreio, sem baixar saldo). */
  @Areas('pcp', 'producao', 'estoque')
  @Post(':id/romaneio-lotes')
  @HttpCode(HttpStatus.OK)
  salvarLotes(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { itens: { codigo?: string; materialId?: number; lote: string }[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.salvarLotes(id, user.empresaId, body?.itens ?? []);
  }

  /** Etiqueta do fardo (corte) para a Zebra: dados + ZPL. destino = facção/setor. */
  @Get(':id/etiqueta')
  etiqueta(
    @Param('id', ParseIntPipe) id: number,
    @Query('destino') destino: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.etiqueta(id, user.empresaId, destino);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateStatus(id, dto, user.empresaId);
  }

  @Patch(':id/grade')
  updateGrade(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpGradeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateGrade(id, dto.grade, user.empresaId);
  }

  /** Confirmação de corte pelo setor (permite parcial quando acaba o tecido). */
  @Areas('pcp', 'producao')
  @Patch(':id/corte')
  registrarCorte(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { grade?: Record<string, unknown>; obs?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.registrarCorte(id, body?.grade ?? {}, body?.obs, user.empresaId);
  }

  @Patch(':id/progresso')
  updateProgresso(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpProgressoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateProgresso(id, dto, user.empresaId);
  }
}
