import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  @Public()
  @Get('*chave')
  async baixar(
    @Param('chave') chave: string | string[],
    @Query('e') expira: string,
    @Query('a') assinatura: string,
    @Res() res: Response,
  ) {
    const caminho = Array.isArray(chave) ? chave.join('/') : String(chave ?? '');
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
