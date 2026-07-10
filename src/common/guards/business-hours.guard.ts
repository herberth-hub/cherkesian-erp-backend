import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../../auth/auth.types';
import { dentroDoHorario, horaAtual } from '../utils/horario.util';

/**
 * Bloqueia perfis NÃO-admin fora do horário comercial cadastrado (SPEC §5).
 * Exceções que passam:
 *  - perfil `total` (admin), sempre;
 *  - tokens emitidos via autorização off-hours (payload.offhours === true);
 *  - usuários sem horário cadastrado (horarioInicio/Fim nulos) => sem restrição.
 */
@Injectable()
export class BusinessHoursGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) return true; // JwtAuthGuard já tratou ausência de auth

    if (user.acesso === 'total' || user.offhours === true) return true;

    const tz = this.config.get<string>('TIMEZONE') || 'America/Sao_Paulo';
    const agora = horaAtual(tz);
    if (dentroDoHorario(agora, user.horarioInicio, user.horarioFim)) {
      return true;
    }

    throw new ForbiddenException(
      `Fora do horário permitido (${user.horarioInicio}–${user.horarioFim}). ` +
        'Solicite autorização do administrador (POST /auth/authorize-offhours).',
    );
  }
}
