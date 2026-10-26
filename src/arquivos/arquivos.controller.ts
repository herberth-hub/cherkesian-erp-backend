import { Controller, ForbiddenException, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ArquivosService } from './arquivos.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('arquivos')
export class ArquivosController {
  constructor(private readonly arquivos: ArquivosService) {}

  /**
   * Entrega um anexo do bucket.
   *
   * A rota é pública de propósito: o `<img src>` do navegador não manda
   * cabeçalho de autorização. Quem autoriza é a ASSINATURA da URL, gerada pela
   * API para quem já estava autenticado, com validade curta. Sem assinatura
   * válida, nada sai daqui.
   */
  // Curinga sem nome, com o caminho em `params[0]`: este projeto roda Nest 10
  // sobre Express 4, onde o curinga NOMEADO do Express 5 (`*chave`) não casa
  // com nada — a rota respondia 404 e toda imagem do bucket vinha quebrada.
  @Public()
  @Get('*')
  async baixar(
    @Req() req: Request,
    @Query('e') expira: string,
    @Query('a') assinatura: string,
    @Res() res: Response,
  ) {
    const caminho = decodeURIComponent(String((req.params as Record<string, string>)[0] ?? ''));
    if (!this.arquivos.conferirAssinatura(caminho, expira, assinatura)) {
      throw new ForbiddenException('Link do anexo inválido ou expirado.');
    }
    const a = await this.arquivos.bytes(`arq:${caminho}`);
    if (!a) throw new ForbiddenException('Anexo não encontrado.');
    res.setHeader('Content-Type', a.tipo);
    // Cacheável no navegador, mas nunca em proxy compartilhado: a URL é pessoal.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(a.bytes);
  }
}
