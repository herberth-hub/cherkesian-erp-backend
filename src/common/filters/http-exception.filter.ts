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
      // estrutura do banco/stack). O cliente recebe apenas o texto genérico.
      this.logger.error(exception.stack ?? exception.message);
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
