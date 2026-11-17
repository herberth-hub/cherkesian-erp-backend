import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MateriaisService } from './materiais.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { podeVerCusto } from '../common/rbac/acesso.config';

// Produção (cadastros/estoque/compras); admin sempre.
@Areas('cadastros', 'estoque', 'compras')
@Controller('materiais')
export class MateriaisController {
  constructor(private readonly materiaisService: MateriaisService) {}

  /**
   * Lista os materiais ATIVOS. `?inativos=1` traz também os inativos — é o que a
   * tela de cadastro usa, para mostrar o inativo com selo e dar para reativar.
   * As telas que OFERECEM material chamam sem o parâmetro e nunca veem cadastro
   * morto.
   */
  @Get()
  async findAll(@CurrentUser() user: AuthUser, @Query('inativos') inativos?: string) {
    const incluir = inativos === '1' || inativos === 'true';
    const lista = await this.materiaisService.findAll(user.empresaId, incluir);
    // O PREÇO DE COMPRA É SÓ DO DONO.
    //
    // Quem separa material, lança nota e faz ordem de compra precisa do código,
    // da descrição, da unidade e do saldo; do que o rolo custou, não. E é por
    // aqui que a receita técnica calculava o custo da peça — esconder só na tela
    // deixaria o número na resposta da API, a um F12 de distância.
    if (podeVerCusto(user)) return lista;
    return lista.map((m) => ({ ...m, custo: null }));
  }

  @Get('abaixo-minimo')
  abaixoDoMinimo(@CurrentUser() user: AuthUser) {
    return this.materiaisService.abaixoDoMinimo(user.empresaId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const m = await this.materiaisService.findOne(id, user.empresaId);
    // Mesma regra da lista: a ficha do material não entrega o preço de compra.
    return podeVerCusto(user) ? m : { ...m, custo: null };
  }

  @Post()
  create(@Body() dto: CreateMaterialDto, @CurrentUser() user: AuthUser) {
    return this.materiaisService.create(dto, user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMaterialDto,
    @CurrentUser() user: AuthUser,
  ) {
    // Quem não enxerga o custo também não o escreve. A tela já esconde o campo,
    // mas sem isto um PATCH com `custo: 0` — de uma aba antiga em cache, ou de
    // qualquer cliente — apagaria o preço de compra sem deixar rastro.
    const limpo = podeVerCusto(user) ? dto : { ...dto, custo: undefined };
    return this.materiaisService.update(id, limpo, user.empresaId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.materiaisService.remove(id, user.empresaId);
  }
}
