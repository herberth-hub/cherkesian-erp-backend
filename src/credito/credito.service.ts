import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditoConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const digitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

interface Resultado {
  situacao: 'regular' | 'restricao' | 'erro';
  score: number | null;
  resumo: string;
  fonte: string;
  detalhe?: Prisma.InputJsonValue;
}

/** Config efetiva (linha do banco ou defaults + fallback das env). */
type CfgEfetiva = Pick<
  CreditoConfig,
  'ativo' | 'provedor' | 'apiUrl' | 'apiToken' | 'authType' | 'oauthTokenUrl' | 'oauthClientId' | 'oauthClientSecret' | 'oauthScope' | 'scoreMin' | 'bloqueiaPedido' | 'validadeDias'
>;

/**
 * Consulta de crédito do cliente (Serasa/parceiro), configurável por empresa:
 *  - `externo`: chama a API (apiUrl) com Bearer estático OU OAuth2 (client_credentials).
 *  - `brasilapi`: situação cadastral do CNPJ na Receita (grátis).
 *  - `simulado`: determinístico, p/ testar o fluxo de bloqueio.
 * Restrição bloqueia o pedido, salvo se o admin liberar o cliente.
 */
@Injectable()
export class CreditoService {
  private readonly logger = new Logger(CreditoService.name);
  // Cache de token OAuth2 por empresa (evita pedir token a cada consulta).
  private tokenCache = new Map<number, { token: string; exp: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ===== Configuração =====
  async getConfig(empresaId: number): Promise<CreditoConfig> {
    let cfg = await this.prisma.creditoConfig.findUnique({ where: { empresaId } });
    if (!cfg) {
      // Primeira vez: cria a partir das env (retrocompat) ou defaults.
      cfg = await this.prisma.creditoConfig.create({
        data: {
          empresaId,
          apiUrl: this.config.get<string>('CREDITO_API_URL') || null,
          apiToken: this.config.get<string>('CREDITO_API_TOKEN') || null,
          provedor: this.config.get<string>('CREDITO_API_URL') ? 'externo' : 'auto',
          bloqueiaPedido: (this.config.get<string>('CREDITO_BLOQUEIA') ?? 'true') !== 'false',
          validadeDias: Number(this.config.get<string>('CREDITO_VALIDADE_DIAS') ?? 30) || 30,
        },
      });
    }
    return cfg;
  }

  /** Config sem os segredos (p/ exibir no front). */
  async getConfigPublica(empresaId: number) {
    const c = await this.getConfig(empresaId);
    return {
      ativo: c.ativo, provedor: c.provedor, apiUrl: c.apiUrl, authType: c.authType,
      oauthTokenUrl: c.oauthTokenUrl, oauthClientId: c.oauthClientId, oauthScope: c.oauthScope,
      scoreMin: c.scoreMin, bloqueiaPedido: c.bloqueiaPedido, validadeDias: c.validadeDias,
      temToken: !!c.apiToken, temSecret: !!c.oauthClientSecret, atualizadoEm: c.atualizadoEm, atualizadoPor: c.atualizadoPor,
    };
  }

  async saveConfig(empresaId: number, dto: Partial<CreditoConfig>, usuario: string) {
    await this.getConfig(empresaId); // garante que existe
    this.tokenCache.delete(empresaId); // invalida token cacheado
    const data: Prisma.CreditoConfigUpdateInput = {
      ativo: dto.ativo, provedor: dto.provedor, apiUrl: dto.apiUrl ?? undefined,
      authType: dto.authType, oauthTokenUrl: dto.oauthTokenUrl ?? undefined,
      oauthClientId: dto.oauthClientId ?? undefined, oauthScope: dto.oauthScope ?? undefined,
      scoreMin: dto.scoreMin, bloqueiaPedido: dto.bloqueiaPedido, validadeDias: dto.validadeDias,
      atualizadoPor: usuario,
    };
    // Segredos: só sobrescreve se vier um valor (string vazia limpa; undefined mantém).
    if (dto.apiToken !== undefined) data.apiToken = dto.apiToken || null;
    if (dto.oauthClientSecret !== undefined) data.oauthClientSecret = dto.oauthClientSecret || null;
    await this.prisma.creditoConfig.update({ where: { empresaId }, data });
    return this.getConfigPublica(empresaId);
  }

  /** Testa a configuração atual com um documento, SEM persistir a consulta. */
  async testar(empresaId: number, documento?: string) {
    const cfg = await this.getConfig(empresaId);
    const doc = digitos(documento) || '11222333000181'; // CNPJ de exemplo (Receita) se não informado
    const r = await this.consultarProvedor(doc, cfg, empresaId);
    return { documento: doc, ...r };
  }

  private async getCliente(clienteId: number, empresaId: number) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    return cliente;
  }

  /** Consulta e PERSISTE o resultado. */
  async consultar(clienteId: number, empresaId: number, usuario: string) {
    const cliente = await this.getCliente(clienteId, empresaId);
    const cfg = await this.getConfig(empresaId);
    const doc = digitos(cliente.cnpjCpf);
    const r = await this.consultarProvedor(doc, cfg, empresaId);
    return this.prisma.consultaCredito.create({
      data: {
        empresaId, clienteId, documento: doc || null, fonte: r.fonte, situacao: r.situacao,
        score: r.score ?? undefined, resumo: r.resumo, detalhe: r.detalhe, consultadoPor: usuario,
      },
    });
  }

  ultimaConsulta(clienteId: number) {
    return this.prisma.consultaCredito.findFirst({ where: { clienteId }, orderBy: { consultadoEm: 'desc' } });
  }

  async liberar(clienteId: number, empresaId: number, usuario: string, liberar = true) {
    await this.getCliente(clienteId, empresaId);
    return this.prisma.cliente.update({
      where: { id: clienteId },
      data: {
        creditoLiberado: liberar,
        creditoLiberadoPor: liberar ? usuario : null,
        creditoLiberadoEm: liberar ? new Date() : null,
      },
      select: { id: true, nome: true, creditoLiberado: true, creditoLiberadoPor: true },
    });
  }

  /** Avalia o cliente para criar um pedido (usa consulta recente ou consulta agora). */
  async avaliarParaPedido(clienteId: number, empresaId: number, usuario: string) {
    const cfg = await this.getConfig(empresaId);
    if (!cfg.bloqueiaPedido || cfg.provedor === 'off' || !cfg.ativo) {
      return { permitido: true, situacao: 'regular', motivo: 'Bloqueio de crédito desativado.' };
    }
    const cliente = await this.getCliente(clienteId, empresaId);
    if (cliente.creditoLiberado) {
      return { permitido: true, situacao: 'liberado', motivo: `Crédito liberado pelo admin (${cliente.creditoLiberadoPor ?? '—'}).` };
    }
    const limite = new Date(Date.now() - (cfg.validadeDias || 30) * 86400000);
    let consulta = await this.prisma.consultaCredito.findFirst({ where: { clienteId, consultadoEm: { gte: limite } }, orderBy: { consultadoEm: 'desc' } });
    if (!consulta) consulta = await this.consultar(clienteId, empresaId, usuario);
    const bloqueado = consulta.situacao === 'restricao';
    return {
      permitido: !bloqueado,
      situacao: consulta.situacao,
      score: consulta.score,
      resumo: consulta.resumo,
      motivo: bloqueado
        ? `Cliente com restrição de crédito: ${consulta.resumo}. Um administrador precisa liberar o cliente para prosseguir.`
        : consulta.resumo,
    };
  }

  // ===== Provedores =====
  private async consultarProvedor(doc: string, cfg: CfgEfetiva, empresaId: number): Promise<Resultado> {
    if (!cfg.ativo || cfg.provedor === 'off') {
      return { situacao: 'regular', score: null, fonte: 'off', resumo: 'Consulta de crédito desativada nas configurações.' };
    }
    if (cfg.provedor === 'simulado') return this.simulado(doc, cfg.scoreMin);
    if (cfg.provedor === 'brasilapi') return doc.length === 14 ? this.brasilApi(doc) : this.simulado(doc, cfg.scoreMin);
    if (cfg.provedor === 'externo' || (cfg.provedor === 'auto' && cfg.apiUrl)) {
      if (cfg.apiUrl) return this.externo(cfg, doc, empresaId);
    }
    // auto sem API externa configurada
    if (doc.length === 14) return this.brasilApi(doc);
    return this.simulado(doc, cfg.scoreMin);
  }

  /** BrasilAPI — situação cadastral do CNPJ na Receita (grátis, sem token). */
  private async brasilApi(cnpj: string): Promise<Resultado> {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { situacao: 'erro', score: null, fonte: 'brasilapi', resumo: `Não foi possível consultar o CNPJ (HTTP ${res.status}).` };
      const desc = String(body['descricao_situacao_cadastral'] ?? '').toUpperCase();
      const razao = String(body['razao_social'] ?? '');
      const regular = /ATIVA/.test(desc);
      return {
        situacao: regular ? 'regular' : 'restricao',
        score: null,
        fonte: 'brasilapi',
        resumo: `Situação na Receita: ${desc || '—'}${razao ? ' · ' + razao : ''}`,
        detalhe: { descricao_situacao_cadastral: desc, razao_social: razao, situacao_cadastral: body['situacao_cadastral'] ?? null } as Prisma.InputJsonValue,
      };
    } catch (err) {
      this.logger.error(`BrasilAPI falhou: ${String(err)}`);
      return { situacao: 'erro', score: null, fonte: 'brasilapi', resumo: 'Erro de comunicação ao consultar o CNPJ.' };
    }
  }

  /** OAuth2 client_credentials — retorna um access_token (com cache por empresa). */
  private async obterTokenOAuth(cfg: CfgEfetiva, empresaId: number): Promise<string | null> {
    if (!cfg.oauthTokenUrl || !cfg.oauthClientId || !cfg.oauthClientSecret) return null;
    const cached = this.tokenCache.get(empresaId);
    if (cached && cached.exp > Date.now() + 5000) return cached.token;
    try {
      const params = new URLSearchParams({ grant_type: 'client_credentials' });
      if (cfg.oauthScope) params.set('scope', cfg.oauthScope);
      const basic = Buffer.from(`${cfg.oauthClientId}:${cfg.oauthClientSecret}`).toString('base64');
      const res = await fetch(cfg.oauthTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
        body: params.toString(),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !body['access_token']) {
        this.logger.error(`OAuth2 token falhou (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
        return null;
      }
      const token = String(body['access_token']);
      const expSec = Number(body['expires_in'] ?? 3000);
      this.tokenCache.set(empresaId, { token, exp: Date.now() + expSec * 1000 });
      return token;
    } catch (err) {
      this.logger.error(`OAuth2 token erro: ${String(err)}`);
      return null;
    }
  }

  /** Provedor externo (Serasa/parceiro). Bearer estático ou OAuth2. Mapeia score/restrição. */
  private async externo(cfg: CfgEfetiva, doc: string, empresaId: number): Promise<Resultado> {
    try {
      let auth: Record<string, string> = {};
      if (cfg.authType === 'oauth2') {
        const token = await this.obterTokenOAuth(cfg, empresaId);
        if (!token) return { situacao: 'erro', score: null, fonte: 'externo', resumo: 'Falha ao autenticar (OAuth2) no provedor de crédito.' };
        auth = { Authorization: `Bearer ${token}` };
      } else if (cfg.authType === 'bearer' && cfg.apiToken) {
        auth = { Authorization: `Bearer ${cfg.apiToken}` };
      }
      const url = cfg.apiUrl!.includes('{doc}') ? cfg.apiUrl!.replace('{doc}', doc) : `${cfg.apiUrl}${cfg.apiUrl!.includes('?') ? '&' : '?'}documento=${doc}`;
      const res = await fetch(url, { headers: { Accept: 'application/json', ...auth } });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { situacao: 'erro', score: null, fonte: 'externo', resumo: `Provedor de crédito HTTP ${res.status}.`, detalhe: body as Prisma.InputJsonValue };
      const score = body['score'] != null ? Number(body['score']) : null;
      const temRestricao =
        body['restricao'] === true ||
        (Array.isArray(body['restricoes']) && (body['restricoes'] as unknown[]).length > 0) ||
        (Array.isArray(body['pendencias']) && (body['pendencias'] as unknown[]).length > 0) ||
        (score != null && score < (cfg.scoreMin || 500));
      return {
        situacao: temRestricao ? 'restricao' : 'regular',
        score,
        fonte: 'externo',
        resumo: String(body['resumo'] ?? (score != null ? `Score ${score}` : 'Consulta realizada')),
        detalhe: body as Prisma.InputJsonValue,
      };
    } catch (err) {
      this.logger.error(`Provedor de crédito externo falhou: ${String(err)}`);
      return { situacao: 'erro', score: null, fonte: 'externo', resumo: 'Erro de comunicação com o provedor de crédito.' };
    }
  }

  /** Simulado — determinístico pelo documento (p/ testar o fluxo de bloqueio). */
  private simulado(doc: string, scoreMin = 500): Resultado {
    const base = doc ? parseInt(doc.slice(-3), 10) || 0 : 500;
    const score = 300 + (base % 701); // 300..1000
    const regular = score >= scoreMin;
    return {
      situacao: regular ? 'regular' : 'restricao',
      score,
      fonte: 'simulado',
      resumo: `Score simulado ${score} (${regular ? 'sem restrição' : 'com restrição'}) — configure a Serasa p/ dados reais.`,
    };
  }
}
