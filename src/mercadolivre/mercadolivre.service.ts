import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Integração Mercado Livre (OAuth2).
 * Guarda credenciais do app (App ID/Secret) e os tokens da conta conectada.
 * Base de tudo: a partir de um access token válido dá para importar pedidos,
 * sincronizar estoque e publicar anúncios (fluxos plugados depois).
 */
@Injectable()
export class MercadoLivreService {
  private readonly log = new Logger('MercadoLivre');
  private readonly API = 'https://api.mercadolibre.com';
  private readonly AUTH = 'https://auth.mercadolivre.com.br/authorization';

  constructor(private readonly prisma: PrismaService) {}

  /** Linha da integração da empresa (cria vazia na primeira vez). */
  private async conta(empresaId: number) {
    const existente = await this.prisma.mercadoLivreConta.findUnique({ where: { empresaId } });
    if (existente) return existente;
    return this.prisma.mercadoLivreConta.create({ data: { empresaId } });
  }

  /** Salva App ID / Secret / Redirect URI (configuração do app no ML). */
  async salvarConfig(empresaId: number, dto: { appId?: string; appSecret?: string; redirectUri?: string }) {
    await this.conta(empresaId);
    const c = await this.prisma.mercadoLivreConta.update({
      where: { empresaId },
      data: {
        appId: dto.appId?.trim() || undefined,
        appSecret: dto.appSecret?.trim() || undefined,
        redirectUri: dto.redirectUri?.trim() || undefined,
      },
    });
    return this.statusDe(c);
  }

  /** Situação da integração (sem expor o secret nem os tokens). */
  async status(empresaId: number) {
    return this.statusDe(await this.conta(empresaId));
  }

  private statusDe(c: {
    appId: string | null;
    appSecret: string | null;
    redirectUri: string | null;
    accessToken: string | null;
    tokenExpira: Date | null;
    mlUserId: string | null;
    nickname: string | null;
    conectadoEm: Date | null;
  }) {
    return {
      configurado: !!(c.appId && c.appSecret && c.redirectUri),
      conectado: !!c.accessToken,
      appId: c.appId ?? null,
      redirectUri: c.redirectUri ?? null,
      temSecret: !!c.appSecret,
      mlUserId: c.mlUserId ?? null,
      nickname: c.nickname ?? null,
      conectadoEm: c.conectadoEm ?? null,
      tokenExpira: c.tokenExpira ?? null,
    };
  }

  /** URL de autorização do ML (o usuário loga na conta dele e autoriza). */
  async authUrl(empresaId: number) {
    const c = await this.conta(empresaId);
    if (!c.appId || !c.redirectUri) {
      throw new BadRequestException('Configure o App ID e a Redirect URI antes de conectar.');
    }
    const url =
      `${this.AUTH}?response_type=code&client_id=${encodeURIComponent(c.appId)}` +
      `&redirect_uri=${encodeURIComponent(c.redirectUri)}&state=${empresaId}`;
    return { url };
  }

  /** Troca o code do callback por access/refresh token e busca a conta. */
  async conectar(empresaId: number, code: string) {
    const c = await this.conta(empresaId);
    if (!c.appId || !c.appSecret || !c.redirectUri) {
      throw new BadRequestException('Configuração incompleta (App ID/Secret/Redirect URI).');
    }
    if (!code?.trim()) throw new BadRequestException('Código de autorização ausente.');

    const tok = await this.postToken({
      grant_type: 'authorization_code',
      client_id: c.appId,
      client_secret: c.appSecret,
      code: code.trim(),
      redirect_uri: c.redirectUri,
    });

    const me = await this.fetchJson(`${this.API}/users/me`, tok.access_token).catch(() => null);
    const atualizado = await this.prisma.mercadoLivreConta.update({
      where: { empresaId },
      data: {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpira: new Date(Date.now() + (Number(tok.expires_in) || 21600) * 1000),
        mlUserId: me?.id != null ? String(me.id) : (tok.user_id != null ? String(tok.user_id) : null),
        nickname: me?.nickname ?? null,
        conectadoEm: new Date(),
      },
    });
    return this.statusDe(atualizado);
  }

  /** Desconecta a conta (remove tokens; mantém a configuração do app). */
  async desconectar(empresaId: number) {
    await this.conta(empresaId);
    const c = await this.prisma.mercadoLivreConta.update({
      where: { empresaId },
      data: { accessToken: null, refreshToken: null, tokenExpira: null, mlUserId: null, nickname: null, conectadoEm: null },
    });
    return this.statusDe(c);
  }

  /**
   * Retorna um access token válido, renovando pelo refresh token quando expira.
   * Usado pelos fluxos (pedidos/estoque/anúncios) — ainda a plugar.
   */
  async tokenValido(empresaId: number): Promise<string> {
    const c = await this.conta(empresaId);
    if (!c.accessToken) throw new BadRequestException('Conta do Mercado Livre não conectada.');
    const margem = 60_000; // renova 1 min antes de expirar
    if (c.tokenExpira && c.tokenExpira.getTime() - margem > Date.now()) return c.accessToken;
    if (!c.refreshToken || !c.appId || !c.appSecret) return c.accessToken;
    const tok = await this.postToken({
      grant_type: 'refresh_token',
      client_id: c.appId,
      client_secret: c.appSecret,
      refresh_token: c.refreshToken,
    });
    const upd = await this.prisma.mercadoLivreConta.update({
      where: { empresaId },
      data: {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? c.refreshToken,
        tokenExpira: new Date(Date.now() + (Number(tok.expires_in) || 21600) * 1000),
      },
    });
    return upd.accessToken!;
  }

  // ===== helpers HTTP (fetch nativo do Node 18+) =====
  private async postToken(params: Record<string, string>): Promise<{
    access_token: string; refresh_token?: string; expires_in?: number; user_id?: number;
  }> {
    const res = await fetch(`${this.API}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.log.warn(`Token ML falhou: ${res.status} ${JSON.stringify(data)}`);
      throw new BadRequestException(`Mercado Livre: ${data?.message || data?.error || 'falha ao obter token'}.`);
    }
    return data;
  }

  private async fetchJson(url: string, token: string): Promise<any> {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (!res.ok) throw new BadRequestException(`Mercado Livre: erro ${res.status} em ${url}.`);
    return res.json();
  }
}
