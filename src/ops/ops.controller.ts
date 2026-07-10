import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { OpsService } from './ops.service';
import { UpdateOpProgressoDto, UpdateOpStatusDto } from './dto/update-op.dto';
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

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOpStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.opsService.updateStatus(id, dto, user.empresaId);
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
