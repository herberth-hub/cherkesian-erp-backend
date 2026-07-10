import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { MovimentarEstoqueDto } from './dto/movimentar.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Areas('estoque')
@Controller('estoque')
export class EstoqueController {
  constructor(private readonly estoqueService: EstoqueService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.estoqueService.findAll(user.empresaId);
  }

  @Get(':codigo/lotes')
  lotes(@Param('codigo') codigo: string, @CurrentUser() user: AuthUser) {
    return this.estoqueService.lotesPorCodigo(codigo, user.empresaId);
  }

  @Post('movimentar')
  @HttpCode(HttpStatus.OK)
  movimentar(@Body() dto: MovimentarEstoqueDto, @CurrentUser() user: AuthUser) {
    return this.estoqueService.movimentar(dto, user.empresaId);
  }
}
