import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsEmail, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { NfeService } from './nfe.service';
import { CreateNfeAvulsaDto } from './dto/create-nfe-avulsa.dto';
import { Areas } from '../common/decorators/acesso.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

class EmitirNfeDto {
  @IsInt()
  @IsPositive()
  expedicaoId!: number;

  /** Quantidade de volumes/caixas declarada no transporte da NF. */
  @IsOptional() @IsInt() @IsPositive() volumes?: number;

  /** Espécie dos volumes (Caixa, Fardo, Pacote…). */
  @IsOptional() @IsString() @MaxLength(30) especie?: string;

  /** Peso líquido total (kg). */
  @IsOptional() @IsNumber() @Min(0) pesoLiquido?: number;

  /** Peso bruto total (kg). */
  @IsOptional() @IsNumber() @Min(0) pesoBruto?: number;

  /** Dimensões (C x L x A) — vai nas informações complementares. */
  @IsOptional() @IsString() @MaxLength(60) dimensoes?: string;

  /** Transportadora cadastrada (dados do quadro TRANSPORTADOR do DANFE). */
  @IsOptional() @IsInt() @IsPositive() transportadoraId?: number;

  /** Placa do veículo (sobrepõe a placa padrão da transportadora). */
  @IsOptional() @IsString() @MaxLength(10) placaVeiculo?: string;

  /** Modalidade do frete: 0=emitente(CIF) 1=destinatário(FOB) 2=terceiros 9=sem frete. */
  @IsOptional() @IsInt() @Min(0) modalidadeFrete?: number;
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
    return this.nfeService.emitir(dto.expedicaoId, user.empresaId, user.usuario, {
      volumes: dto.volumes,
      especie: dto.especie,
      pesoLiquido: dto.pesoLiquido,
      pesoBruto: dto.pesoBruto,
      dimensoes: dto.dimensoes,
      transportadoraId: dto.transportadoraId,
      placaVeiculo: dto.placaVeiculo,
      modalidadeFrete: dto.modalidadeFrete,
    });
  }

  /** NF de REMESSA p/ industrialização (facção com CNPJ). Produção/expedição emitem. */
  @Post('remessa')
  @Areas('producao', 'expedicao')
  @HttpCode(HttpStatus.CREATED)
  remessa(@Body('controleFaccao') controleFaccao: string, @CurrentUser() user: AuthUser) {
    return this.nfeService.emitirRemessa(String(controleFaccao || '').trim(), user.empresaId, user.usuario);
  }

  /** NF de simples faturamento (venda para entrega futura) — cobrança cheia do pedido. */
  @Post('faturamento')
  @Areas('vendas', 'expedicao', 'receber')
  @HttpCode(HttpStatus.CREATED)
  faturamento(@Body() dto: { pedidoId: number; sinalRecebido?: number; volumes?: number }, @CurrentUser() user: AuthUser) {
    return this.nfeService.emitirFaturamento(Number(dto.pedidoId), user.empresaId, user.usuario, { sinalRecebido: dto.sinalRecebido, volumes: dto.volumes });
  }

  /** NF de remessa (entrega futura) — acompanha a entrega parcial, ref. o faturamento. */
  @Post('remessa-futura')
  @Areas('vendas', 'expedicao')
  @HttpCode(HttpStatus.CREATED)
  remessaFutura(@Body() dto: { expedicaoId: number; volumes?: number; especie?: string; pesoLiquido?: number; pesoBruto?: number }, @CurrentUser() user: AuthUser) {
    return this.nfeService.emitirRemessaFutura(Number(dto.expedicaoId), user.empresaId, user.usuario, { volumes: dto.volumes, especie: dto.especie, pesoLiquido: dto.pesoLiquido, pesoBruto: dto.pesoBruto });
  }

  /** NF-e avulsa: cliente + itens, sem expedição. Comercial também emite. */
  @Post('avulsa')
  @Areas('vendas', 'expedicao', 'receber')
  @HttpCode(HttpStatus.CREATED)
  avulsa(@Body() dto: CreateNfeAvulsaDto, @CurrentUser() user: AuthUser) {
    return this.nfeService.emitirAvulsa(dto, user.empresaId, user.usuario);
  }

  /** Cruza e corrige o CFOP das notas com o CFOP real do XML autorizado (contabilidade). */
  @Post('cfop/sincronizar')
  @Areas('expedicao', 'receber')
  @HttpCode(HttpStatus.OK)
  sincronizarCfop(@CurrentUser() user: AuthUser) {
    return this.nfeService.sincronizarCfopXml(user.empresaId);
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

  /** Baixa o DANFE (PDF) da nota para impressão/arquivo. */
  @Get(':id/danfe')
  @Areas('vendas', 'expedicao', 'receber')
  async danfe(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const a = await this.nfeService.baixarArquivo(id, user.empresaId, 'danfe');
    res.set({ 'Content-Type': a.contentType, 'Content-Disposition': `inline; filename="${a.filename}"` });
    return new StreamableFile(a.content);
  }

  /** Baixa/imprime o PDF da Carta de Correção (CC-e). */
  @Get(':id/carta-correcao/pdf')
  async cartaCorrecaoPdf(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const a = await this.nfeService.cartaCorrecaoPdf(id, user.empresaId);
    res.set({ 'Content-Type': a.contentType, 'Content-Disposition': `inline; filename="${a.filename}"` });
    return new StreamableFile(a.content);
  }

  /** Baixa o XML autorizado da nota. */
  @Get(':id/xml')
  @Areas('vendas', 'expedicao', 'receber')
  async xml(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const a = await this.nfeService.baixarArquivo(id, user.empresaId, 'xml');
    res.set({ 'Content-Type': a.contentType, 'Content-Disposition': `attachment; filename="${a.filename}"` });
    return new StreamableFile(a.content);
  }

  /** Exclui o registro de uma nota NÃO autorizada e devolve o número sequencial. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  excluir(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.nfeService.excluir(id, user.empresaId);
  }
}
