import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { DocumentosService } from './documentos.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { EnviarEmailDto } from './dto/enviar-email.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * Geração de documentos em papel timbrado (SPEC §4).
 * RBAC é validado POR TIPO no service (proposta→vendas, op→producao, ...).
 */
@Controller('documentos')
export class DocumentosController {
  constructor(private readonly documentosService: DocumentosService) {}

  @Get()
  listar() {
    return this.documentosService.listar();
  }

  @Post(':tipo')
  criar(
    @Param('tipo') tipo: string,
    @Body() dto: CreateDocumentoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentosService.criar(tipo, dto.referenciaId, user);
  }

  /** Envia o documento por e-mail com o PDF anexo (integração de e-mail). */
  @Post(':id/enviar-email')
  enviarEmail(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnviarEmailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentosService.enviarPorEmail(id, user, dto.para, dto.assunto, dto.mensagem);
  }

  /** Stream do PDF (gerado sob demanda a partir dos dados atuais do banco). */
  @Get(':id/pdf')
  async pdf(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { doc, numero } = await this.documentosService.gerarPdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${numero}.pdf"`);
    doc.pipe(res);
    doc.end();
  }
}
