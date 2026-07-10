import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca uma rota como pública (ignora JwtAuthGuard/RolesGuard/BusinessHoursGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
