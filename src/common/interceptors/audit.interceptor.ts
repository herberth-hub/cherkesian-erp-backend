import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../auth/auth.types';

const METODOS_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Auditoria global: toda ESCRITA bem-sucedida grava um registro imutável em `Log`
 * (usuário, ação, entidade, ip, timestamp) — SPEC §2 e §5.
 * Falha ao gravar o log nunca quebra a resposta ao cliente.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const method = request.method;

    if (!METODOS_ESCRITA.has(method)) {
      return next.handle();
    }

    const usuario = request.user?.usuario ?? 'anonimo';
    const ip = this.extrairIp(request);
    const entidade = this.extrairEntidade(request.path);
    const entidadeId = this.extrairId(request.params);
    const acao = `${method} ${request.path}`;

    return next.handle().pipe(
      tap({
        next: () => {
          void this.gravar({ usuario, acao, entidade, entidadeId, ip });
        },
      }),
    );
  }

  private async gravar(dados: {
    usuario: string;
    acao: string;
    entidade?: string;
    entidadeId?: string;
    ip?: string;
  }): Promise<void> {
    try {
      await this.prisma.log.create({ data: dados });
    } catch (err) {
      this.logger.error(`Falha ao gravar auditoria: ${String(err)}`);
    }
  }

  private extrairEntidade(path: string): string | undefined {
    // /api/v1/usuarios/3 -> "usuarios"
    const partes = path.split('/').filter(Boolean);
    const idx = partes.findIndex((p) => p === 'v1');
    const alvo = idx >= 0 ? partes[idx + 1] : partes[0];
    return alvo;
  }

  private extrairId(params: Record<string, string> | undefined): string | undefined {
    if (!params) return undefined;
    return params.id ?? Object.values(params)[0];
  }

  private extrairIp(request: Request): string | undefined {
    const fwd = request.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return request.ip ?? request.socket?.remoteAddress ?? undefined;
  }
}
