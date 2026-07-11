import { Controller, Get, Query } from '@nestjs/common';
import { LogsService } from './logs.service';
import { Areas } from '../common/decorators/acesso.decorator';

// Área "logs" — somente o perfil `total` (admin) a enxerga.
@Areas('logs')
@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  findAll(
    @Query('usuario') usuario?: string,
    @Query('entidade') entidade?: string,
    @Query('limit') limit?: string,
  ) {
    // parse manual: o ValidationPipe global (implicit conversion) conflita com ParseIntPipe optional
    const n = limit ? Number(limit) : undefined;
    return this.logsService.findAll({ usuario, entidade, limit: Number.isInteger(n) ? n : undefined });
  }
}
