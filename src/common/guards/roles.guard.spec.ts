import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AREAS_KEY } from '../decorators/acesso.decorator';
import { Area } from '../rbac/acesso.config';
import { Acesso } from '@prisma/client';

function makeContext(user: { acesso: Acesso } | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (RBAC por área)', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const stubMetadata = (opts: { isPublic?: boolean; areas?: Area[] }) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
        if (key === AREAS_KEY) return opts.areas;
        return undefined;
      });
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('nega perfil sem a área exigida (comercial -> usuarios)', () => {
    stubMetadata({ areas: ['usuarios'] });
    expect(() => guard.canActivate(makeContext({ acesso: 'comercial' }))).toThrow(
      ForbiddenException,
    );
  });

  it('libera perfil total para qualquer área (total -> usuarios)', () => {
    stubMetadata({ areas: ['usuarios'] });
    expect(guard.canActivate(makeContext({ acesso: 'total' }))).toBe(true);
  });

  it('libera quando o perfil enxerga a área (comercial -> vendas)', () => {
    stubMetadata({ areas: ['vendas'] });
    expect(guard.canActivate(makeContext({ acesso: 'comercial' }))).toBe(true);
  });

  it('rota sem @Areas exige apenas login (passa)', () => {
    stubMetadata({ areas: undefined });
    expect(guard.canActivate(makeContext({ acesso: 'chao' }))).toBe(true);
  });

  it('rota pública passa direto', () => {
    stubMetadata({ isPublic: true });
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });
});
