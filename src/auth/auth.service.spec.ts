import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

// Controla a "hora atual" para testar o bloqueio por horário de forma determinística.
jest.mock('../common/utils/horario.util', () => {
  const actual = jest.requireActual('../common/utils/horario.util');
  return { ...actual, horaAtual: jest.fn(() => '20:00') };
});

type UsuarioRow = {
  id: number;
  empresaId: number;
  nome: string;
  usuario: string;
  senhaHash: string;
  acesso: string;
  setor: string | null;
  cargo: string | null;
  horarioInicio: string | null;
  horarioFim: string | null;
  ativo: boolean;
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { usuario: { findUnique: jest.Mock }; log: { create: jest.Mock } };
  let jwt: { signAsync: jest.Mock };
  let admin: UsuarioRow;
  let comercial: UsuarioRow;

  beforeAll(async () => {
    admin = {
      id: 1,
      empresaId: 1,
      nome: 'Admin',
      usuario: 'admin',
      senhaHash: await bcrypt.hash('cherkesian', 10),
      acesso: 'total',
      setor: 'Gestão',
      cargo: 'Diretor',
      horarioInicio: null,
      horarioFim: null,
      ativo: true,
    };
    comercial = {
      id: 2,
      empresaId: 1,
      nome: 'Camila',
      usuario: 'camila',
      senhaHash: await bcrypt.hash('vendas123', 10),
      acesso: 'comercial',
      setor: 'Comercial',
      cargo: 'Vendas',
      horarioInicio: '08:00',
      horarioFim: '18:00',
      ativo: true,
    };
  });

  beforeEach(() => {
    prisma = {
      usuario: { findUnique: jest.fn() },
      log: { create: jest.fn().mockResolvedValue({}) },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    const config = {
      get: (k: string) =>
        ({
          JWT_SECRET: 's',
          JWT_REFRESH_SECRET: 'r',
          JWT_ACCESS_EXPIRES: '15m',
          JWT_REFRESH_EXPIRES: '7d',
          TIMEZONE: 'America/Sao_Paulo',
        })[k],
    } as unknown as ConfigService;

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config,
    );
  });

  describe('login', () => {
    it('login válido (admin) retorna tokens', async () => {
      prisma.usuario.findUnique.mockResolvedValue(admin);
      const res = await service.login({ usuario: 'admin', senha: 'cherkesian' });
      expect(res.accessToken).toBe('signed.jwt.token');
      expect(res.refreshToken).toBe('signed.jwt.token');
      expect(res.usuario.usuario).toBe('admin');
      expect(jwt.signAsync).toHaveBeenCalledTimes(2); // access + refresh
    });

    it('senha inválida lança Unauthorized', async () => {
      prisma.usuario.findUnique.mockResolvedValue(admin);
      await expect(
        service.login({ usuario: 'admin', senha: 'errada' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('usuário inexistente lança Unauthorized', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ usuario: 'ninguem', senha: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('usuário inativo lança Unauthorized', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...comercial, ativo: false });
      await expect(
        service.login({ usuario: 'camila', senha: 'vendas123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('não-admin fora do horário (20:00 fora de 08–18) lança Forbidden', async () => {
      prisma.usuario.findUnique.mockResolvedValue(comercial);
      await expect(
        service.login({ usuario: 'camila', senha: 'vendas123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('authorizeOffhours', () => {
    it('admin libera acesso fora do horário e audita', async () => {
      prisma.usuario.findUnique.mockImplementation(({ where }: { where: { usuario: string } }) =>
        Promise.resolve(where.usuario === 'admin' ? admin : comercial),
      );
      const res = await service.authorizeOffhours({
        usuario: 'camila',
        senha: 'vendas123',
        adminUsuario: 'admin',
        adminSenha: 'cherkesian',
      });
      expect(res.accessToken).toBe('signed.jwt.token');
      expect(prisma.log.create).toHaveBeenCalledTimes(1); // liberação auditada
    });

    it('autorizador não-admin lança Forbidden', async () => {
      prisma.usuario.findUnique.mockResolvedValue(comercial);
      await expect(
        service.authorizeOffhours({
          usuario: 'camila',
          senha: 'vendas123',
          adminUsuario: 'camila',
          adminSenha: 'vendas123',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
