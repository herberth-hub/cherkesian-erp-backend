import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { FiliaisService } from './filiais.service';
import { CreateFilialDto } from './dto/create-filial.dto';
import { UpdateFilialDto } from './dto/update-filial.dto';
import { ContaBancariaDto, UpdateContaBancariaDto } from './dto/conta-bancaria.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

// Leitura liberada aos perfis que criam pedido/OP/NF (para o seletor de filial);
// escrita (cadastro fiscal) é administrativa — método-nível @Areas('usuarios').
@Areas('vendas', 'pcp', 'producao', 'expedicao', 'usuarios')
@Controller('filiais')
export class FiliaisController {
  constructor(private readonly filiaisService: FiliaisService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.filiaisService.findAll(user.empresaId);
  }

  // ===== Contas bancárias (rotas literais ANTES de :id) =====
  /** Lista as contas bancárias da empresa (para o select de baixa e o gerenciador). */
  @Areas('pagar', 'receber', 'usuarios')
  @Get('contas-bancarias')
  listarContas(@CurrentUser() user: AuthUser) {
    return this.filiaisService.listarContas(user.empresaId);
  }

  @Areas('pagar', 'usuarios')
  @Post(':id/contas-bancarias')
  criarConta(@Param('id', ParseIntPipe) filialId: number, @Body() dto: ContaBancariaDto, @CurrentUser() user: AuthUser) {
    return this.filiaisService.criarConta(filialId, dto, user.empresaId);
  }

  @Areas('pagar', 'usuarios')
  @Patch('contas-bancarias/:contaId')
  atualizarConta(@Param('contaId', ParseIntPipe) contaId: number, @Body() dto: UpdateContaBancariaDto, @CurrentUser() user: AuthUser) {
    return this.filiaisService.atualizarConta(contaId, dto, user.empresaId);
  }

  @Areas('pagar', 'usuarios')
  @Delete('contas-bancarias/:contaId')
  removerConta(@Param('contaId', ParseIntPipe) contaId: number, @CurrentUser() user: AuthUser) {
    return this.filiaisService.removerConta(contaId, user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.filiaisService.findOne(id, user.empresaId);
  }

  @Areas('usuarios')
  @Post()
  create(@Body() dto: CreateFilialDto, @CurrentUser() user: AuthUser) {
    return this.filiaisService.create(dto, user.empresaId);
  }

  @Areas('usuarios')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFilialDto, @CurrentUser() user: AuthUser) {
    return this.filiaisService.update(id, dto, user.empresaId);
  }

  @Areas('usuarios')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.filiaisService.remove(id, user.empresaId);
  }
}
