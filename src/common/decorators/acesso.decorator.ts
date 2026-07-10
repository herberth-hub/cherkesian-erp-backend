import { SetMetadata } from '@nestjs/common';
import { Area } from '../rbac/acesso.config';

export const AREAS_KEY = 'areasRequeridas';

/**
 * Declara quais áreas a rota exige. O `RolesGuard` libera se o perfil do usuário
 * enxerga PELO MENOS UMA das áreas informadas (ou se o perfil é `total`).
 *
 * Ex.: `@Areas('usuarios')` -> só o perfil `total` (admin).
 */
export const Areas = (...areas: Area[]) => SetMetadata(AREAS_KEY, areas);
