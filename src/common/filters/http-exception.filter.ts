import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Padroniza TODAS as respostas de erro num envelope único (SPEC §2):
 * { statusCode, error, message, path, timestamp }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Erro interno no servidor.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
        error = exception.name;
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as { message?: string | string[]; error?: string };
        message = r.message ?? exception.message;
        error = r.error ?? exception.name;
      }
    } else if (exception instanceof Error) {
      // Erro não-HTTP (ex.: falha inesperada/Prisma): registra o detalhe real no
      // servidor, mas NUNCA devolve a mensagem interna ao cliente (evita vazar
      // estrutura do banco/stack). O cliente recebe o texto genérico + uma
      // REFERÊNCIA curta que também vai para o log: é por ela que se acha o erro
      // de verdade depois, em vez de só saber que "deu erro interno".
      const ref = Date.now().toString(36).slice(-4).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0').toUpperCase();
      // O código do Prisma (P####) é uma classe de erro, não expõe estrutura do banco,
      // e diz de cara se foi tempo de transação (P2028), duplicidade (P2002) etc.
      const bruto = (exception as { code?: unknown }).code;
      const codigo = typeof bruto === 'string' && /^P\d{4}$/.test(bruto) ? bruto : null;
      message = `Erro interno no servidor. Referência ${ref}${codigo ? ` · ${codigo}` : ''} — informe este código para localizarmos a causa.`;
      this.logger.error(
        `[${ref}]${codigo ? ` ${codigo}` : ''} ${request.method} ${request.url}\n${exception.stack ?? exception.message}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
