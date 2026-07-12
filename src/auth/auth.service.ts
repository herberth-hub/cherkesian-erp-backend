import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/** HTTP 423 Locked — conta bloqueada (não colide com o 403 do gate off-hours). */
const HTTP_LOCKED = 423;
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Usuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.types';
import { dentroDoHorario, horaAtual } from '../common/utils/horario.util';
import { LoginDto } from './dto/login.dto';
import { AuthorizeOffhoursDto } from './dto/authorize-offhours.dto';

export interface TokensResposta {
  accessToken: string;
  refreshToken: string;
  usuario: {
    id: number;
    nome: string;
    usuario: string;
    acesso: string;
    setor: string | null;
    cargo: string | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Máximo de tentativas de login malsucedidas antes do bloqueio da conta. */
  private readonly MAX_TENTATIVAS = 3;

  /**
   * Valida usuário + senha (bcrypt). Lança 401 se inválido/inativo, 423 se a
   * conta estiver bloqueada. Após 3 falhas seguidas, bloqueia a conta (somente
   * o administrador desbloqueia). O perfil `total` (admin) é ISENTO do
   * auto-bloqueio para não travar o ERP — segue protegido pelo rate-limit.
   */
  async validarCredenciais(usuario: string, senha: string): Promise<Usuario> {
    const user = await this.prisma.usuario.findUnique({ where: { usuario } });
    if (!user || !user.ativo) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }
    if (user.bloqueado) {
      throw new HttpException(
        'Conta bloqueada por tentativas de acesso. Solicite o desbloqueio ao administrador do ERP.',
        HTTP_LOCKED,
      );
    }
    const ok = await bcrypt.compare(senha, user.senhaHash);
    if (!ok) {
      if (user.acesso !== 'total') {
        const tentativas = user.tentativasFalhas + 1;
        const bloquear = tentativas >= this.MAX_TENTATIVAS;
        await this.prisma.usuario.update({
          where: { id: user.id },
          data: {
            tentativasFalhas: tentativas,
            bloqueado: bloquear,
            bloqueadoEm: bloquear ? new Date() : null,
          },
        });
        if (bloquear) {
          throw new HttpException(
            `Conta bloqueada após ${this.MAX_TENTATIVAS} tentativas incorretas. Solicite o desbloqueio ao administrador do ERP.`,
            HTTP_LOCKED,
          );
        }
      }
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }
    // Sucesso: zera o contador de falhas se havia alguma.
    if (user.tentativasFalhas > 0) {
      await this.prisma.usuario.update({ where: { id: user.id }, data: { tentativasFalhas: 0 } });
    }
    return user;
  }

  /** Login normal. Perfis não-admin só entram dentro do horário comercial. */
  async login(dto: LoginDto): Promise<TokensResposta> {
    const user = await this.validarCredenciais(dto.usuario, dto.senha);

    if (user.acesso !== 'total') {
      const tz = this.config.get<string>('TIMEZONE') || 'America/Sao_Paulo';
      const agora = horaAtual(tz);
      if (!dentroDoHorario(agora, user.horarioInicio, user.horarioFim)) {
        throw new ForbiddenException(
          `Acesso fora do horário permitido (${user.horarioInicio}–${user.horarioFim}). ` +
            'Solicite autorização do administrador (POST /auth/authorize-offhours).',
        );
      }
    }

    return this.emitirTokens(user, false);
  }

  /**
   * Autorização fora do horário: o admin (perfil `total`) libera o acesso de um
   * usuário fora da janela. Emite tokens marcados com `offhours: true` e audita.
   */
  async authorizeOffhours(dto: AuthorizeOffhoursDto, ip?: string): Promise<TokensResposta> {
    // 1) admin precisa ser válido e ter perfil total
    const admin = await this.validarCredenciais(dto.adminUsuario, dto.adminSenha);
    if (admin.acesso !== 'total') {
      throw new ForbiddenException('Somente um administrador pode autorizar acesso fora do horário.');
    }
    // 2) usuário-alvo precisa ter credenciais válidas
    const alvo = await this.validarCredenciais(dto.usuario, dto.senha);

    // 3) auditoria explícita da liberação
    await this.prisma.log.create({
      data: {
        usuario: admin.usuario,
        acao: 'POST /auth/authorize-offhours',
        detalhe: `Liberou acesso fora do horário para "${alvo.usuario}".`,
        entidade: 'auth',
        entidadeId: String(alvo.id),
        ip,
      },
    });

    return this.emitirTokens(alvo, true);
  }

  /** Renova o access token a partir de um refresh token válido. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }
    if (payload.tipo !== 'refresh') {
      throw new UnauthorizedException('Token informado não é um refresh token.');
    }

    const user = await this.prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!user || !user.ativo) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo.');
    }

    const tokens = await this.emitirTokens(user, payload.offhours === true);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  /** Monta e assina o par de tokens (access + refresh). */
  private async emitirTokens(user: Usuario, offhours: boolean): Promise<TokensResposta> {
    const base: JwtPayload = {
      sub: user.id,
      usuario: user.usuario,
      nome: user.nome,
      acesso: user.acesso,
      empresaId: user.empresaId,
      horarioInicio: user.horarioInicio,
      horarioFim: user.horarioFim,
      offhours,
    };

    const accessToken = await this.jwt.signAsync(
      { ...base, tipo: 'access' },
      {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES') || '15m',
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { ...base, tipo: 'refresh' },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES') || '7d',
      },
    );

    return {
      accessToken,
      refreshToken,
      usuario: {
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        acesso: user.acesso,
        setor: user.setor,
        cargo: user.cargo,
      },
    };
  }
}
