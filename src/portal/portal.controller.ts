import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { PortalService } from './portal.service';
import { CriarPedidoPortalDto } from './dto/criar-pedido-portal.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * Portal do Cliente. Restrito à área `portal` — só o perfil `cliente` (e o admin
 * `total`, para pré-visualizar) chega aqui. O escopo do cliente é travado no token.
 */
@Areas('portal')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.resumo(user, clienteId ? Number(clienteId) : undefined);
  }

  @Get('estoque')
  estoque(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.estoque(user, clienteId ? Number(clienteId) : undefined);
  }

  @Get('producao')
  producao(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.producao(user, clienteId ? Number(clienteId) : undefined);
  }

  /** Contratos vigentes do cliente com seus itens (fluxo "contrato primeiro") + produtos fora de contrato. */
  @Get('contratos')
  contratos(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.contratos(user, clienteId ? Number(clienteId) : undefined);
  }

  /** Foto do produto (fotoModelo) — só de produtos do catálogo/contratos do cliente. */
  @Get('produtos/:id/foto')
  async fotoProduto(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
    @Query('clienteId') clienteId?: string,
  ) {
    const f = await this.portal.fotoProduto(user, id, clienteId ? Number(clienteId) : undefined);
    res.set({ 'Content-Type': f.contentType, 'Cache-Control': 'private, max-age=3600' });
    return new StreamableFile(f.content);
  }

  /** Unidades do cliente (seletor do portal) + quantos contratos vigentes cada uma tem. */
  @Get('unidades')
  unidades(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.unidades(user, clienteId ? Number(clienteId) : undefined);
  }

  /** Catálogo "Disponível para compra": produtos + preço (contrato da unidade/geral/tabela) + saldo + prazo. */
  @Get('catalogo')
  catalogo(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string, @Query('unidadeId') unidadeId?: string) {
    return this.portal.catalogo(user, clienteId ? Number(clienteId) : undefined, unidadeId ? Number(unidadeId) : undefined);
  }

  /**
   * Pedido enviado pelo portal (carrinho). Nasce no ERP aguardando validação da equipe
   * (etapa orçamento), gera alerta no ERP + e-mail de aviso. Idempotente pela chave.
   */
  @Post('pedidos')
  criarPedido(@Body() dto: CriarPedidoPortalDto, @CurrentUser() user: AuthUser, @Ip() ip: string, @Query('clienteId') clienteId?: string) {
    return this.portal.criarPedido(user, dto, clienteId ? Number(clienteId) : undefined, ip);
  }

  @Get('notas')
  notas(@CurrentUser() user: AuthUser, @Query('clienteId') clienteId?: string) {
    return this.portal.notas(user, clienteId ? Number(clienteId) : undefined);
  }

  /** Baixa DANFE (PDF) ou XML de uma nota do cliente. Escopo travado no service. */
  @Get('notas/:id/:tipo')
  async baixarNota(
    @Param('id', ParseIntPipe) id: number,
    @Param('tipo') tipo: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Query('clienteId') clienteId?: string,
  ) {
    if (tipo !== 'danfe' && tipo !== 'xml') throw new BadRequestException('Tipo inválido (use danfe ou xml).');
    const a = await this.portal.baixarNota(user, id, tipo, clienteId ? Number(clienteId) : undefined, ip);
    res.set({
      'Content-Type': a.contentType,
      'Content-Disposition': `${tipo === 'danfe' ? 'inline' : 'attachment'}; filename="${a.filename}"`,
    });
    return new StreamableFile(a.content);
  }
}
