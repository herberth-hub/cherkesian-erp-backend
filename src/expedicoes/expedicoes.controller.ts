import { Body, Controller, Get, Post } from '@nestjs/common';
import { ExpedicoesService } from './expedicoes.service';
import { CreateExpedicaoDto } from './dto/create-expedicao.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('expedicao')
@Controller('expedicoes')
export class ExpedicoesController {
  constructor(private readonly expedicoesService: ExpedicoesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.expedicoesService.findAll(user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateExpedicaoDto, @CurrentUser() user: AuthUser) {
    return this.expedicoesService.create(dto, user.empresaId);
  }
}
