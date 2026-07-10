import { Acesso } from '@prisma/client';

/** Payload assinado no JWT de acesso. */
export interface JwtPayload {
  sub: number; // id do usuário
  usuario: string;
  nome: string;
  acesso: Acesso;
  empresaId: number;
  horarioInicio?: string | null;
  horarioFim?: string | null;
  /** true quando o token foi emitido via autorização fora do horário (admin). */
  offhours?: boolean;
  /** discrimina access vs refresh token. */
  tipo?: 'access' | 'refresh';
}

/** Usuário autenticado, anexado a `request.user`. */
export type AuthUser = JwtPayload;
