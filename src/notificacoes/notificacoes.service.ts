import { Injectable, Logger } from '@nestjs/common';
import { Acesso, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACESSO_AREAS, ALL_AREAS, Area } from '../common/rbac/acesso.config';
import { AuthUser } from '../auth/auth.types';

type CriarDto = {
  tipo: string;
  areas: Area[];
  titulo: string;
  mensagem: string;
  refTipo?: string | null;
  refId?: number | null;
};

/** Quantos dias uma notificação continua "pendente" (exigindo ciência) se ninguém deu OK. */
const JANELA_DIAS = 7;

@Injectable()
export class NotificacoesService {
  private readonly logger = new Logger(NotificacoesService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Áreas que o perfil enxerga (null = todas, perfil `total`). */
  private areasDoPerfil(acesso: Acesso): readonly Area[] | null {
    const a = ACESSO_AREAS[acesso];
    return a === ALL_AREAS ? null : a;
  }

  /**
   * Cria uma notificação dirigida a áreas. NUNCA lança para não quebrar o fluxo de
   * negócio (criar pedido/OP) — em erro, apenas registra no log.
   */
  async criar(empresaId: number, dto: CriarDto): Promise<void> {
    try {
      await this.prisma.notificacao.create({
        data: {
          empresaId,
          tipo: dto.tipo,
          areas: (dto.areas ?? []) as unknown as Prisma.InputJsonValue,
          titulo: dto.titulo.slice(0, 200),
          mensagem: dto.mensagem.slice(0, 1000),
          refTipo: dto.refTipo ?? null,
          refId: dto.refId ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`Falha ao criar notificação (${dto.tipo}): ${(e as Error).message}`);
    }
  }

  /**
   * Notificações que ESTE usuário ainda não deu ciência, dentro da janela, cujas
   * áreas-alvo o perfil dele enxerga (perfil `total` vê todas).
   */
  async pendentes(user: AuthUser) {
    const desde = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    const recentes = await this.prisma.notificacao.findMany({
      where: { empresaId: user.empresaId, criadoEm: { gte: desde } },
      orderBy: { criadoEm: 'desc' },
      take: 100,
      include: { ciencias: { where: { usuarioId: user.sub }, select: { id: true } } },
    });
    const areasUsuario = this.areasDoPerfil(user.acesso); // null = todas
    const podeVer = (areas: unknown): boolean => {
      if (areasUsuario === null) return true; // perfil total
      const arr = Array.isArray(areas) ? (areas as string[]) : [];
      if (!arr.length) return false;
      return arr.some((a) => (areasUsuario as readonly string[]).includes(a));
    };
    return recentes
      .filter((n) => n.ciencias.length === 0 && podeVer(n.areas))
      .map((n) => ({
        id: n.id,
        tipo: n.tipo,
        titulo: n.titulo,
        mensagem: n.mensagem,
        refTipo: n.refTipo,
        refId: n.refId,
        criadoEm: n.criadoEm,
      }));
  }

  /** Registra a ciência do usuário (idempotente). */
  async marcarCiente(id: number, user: AuthUser): Promise<{ ok: true }> {
    const n = await this.prisma.notificacao.findUnique({ where: { id }, select: { empresaId: true } });
    if (n && n.empresaId === user.empresaId) {
      await this.prisma.notificacaoCiencia.upsert({
        where: { notificacaoId_usuarioId: { notificacaoId: id, usuarioId: user.sub } },
        create: { notificacaoId: id, usuarioId: user.sub },
        update: {},
      });
    }
    return { ok: true };
  }

  /** Marca ciência de TODAS as pendentes do usuário de uma vez. */
  async marcarTodas(user: AuthUser): Promise<{ ok: true; total: number }> {
    const pend = await this.pendentes(user);
    for (const p of pend) await this.marcarCiente(p.id, user);
    return { ok: true, total: pend.length };
  }
}
