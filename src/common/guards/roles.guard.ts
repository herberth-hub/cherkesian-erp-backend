import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AREAS_KEY } from '../decorators/acesso.decorator';
import { Area, perfilPodeAcessar } from '../rbac/acesso.config';
import { JwtPayload } from '../../auth/auth.types';

/**
 * RBAC por área (SPEC §5). Libera se o perfil do usuário enxerga PELO MENOS UMA
 * das áreas exigidas pela rota. Rotas sem `@Areas(...)` passam (só exigem login).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const areas = this.reflector.getAllAndOverride<Area[]>(AREAS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!areas || areas.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Usuário não autenticado.');
    }

    const permitido = areas.some((area) => perfilPodeAcessar(user.acesso, area));
    if (!permitido) {
      throw new ForbiddenException(
        `Perfil "${user.acesso}" não tem acesso a esta operação.`,
      );
    }
    return true;
  }
}
