import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const digitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

interface Resultado {
  situacao: 'regular' | 'restricao' | 'erro';
  score: number | null;
  resumo: string;
  fonte: string;
  detalhe?: Prisma.InputJsonValue;
}

/**
 * Consulta de crédito do cliente (provider-agnóstica):
 *  - CNPJ: BrasilAPI (grátis) — situação cadastral na Receita (ATIVA => regular).
 *  - Genérico externo: se CREDITO_API_URL/TOKEN configurados (ex.: Serasa via
 *    revendedor), chama o endpoint e mapeia score/situação.
 *  - Fallback (CPF ou sem doc): modo `simulado` (determinístico) p/ testar o fluxo.
 *
 * Regra: situação `restricao` bloqueia o pedido, salvo se o admin liberou o cliente.
 */
@Injectable()
export class CreditoService {
  private readonly logger = new Logger(CreditoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get bloqueiaPedido(): boolean {
    return (this.config.get<string>('CREDITO_BLOQUEIA') ?? 'true') !== 'false';
  }
  private get validadeDias(): number {
    return Number(this.config.get<string>('CREDITO_VALIDADE_DIAS') ?? 30) || 30;
  }

  private async getCliente(clienteId: number, empresaId: number) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    return cliente;
  }

  /** Consulta e PERSISTE o resultado. */
  async consultar(clienteId: number, empresaId: number, usuario: string) {
    const cliente = await this.getCliente(clienteId, empresaId);
    const doc = digitos(cliente.cnpjCpf);
    const r = await this.consultarProvedor(doc);
    const consulta = await this.prisma.consultaCredito.create({
      data: {
        empresaId,
        clienteId,
        documento: doc || null,
        fonte: r.fonte,
        situacao: r.situacao,
        score: r.score ?? undefined,
        resumo: r.resumo,
        detalhe: r.detalhe,
        consultadoPor: usuario,
      },
    });
    return consulta;
  }

  ultimaConsulta(clienteId: number) {
    return this.prisma.consultaCredito.findFirst({ where: { clienteId }, orderBy: { consultadoEm: 'desc' } });
  }

  /** Libera o cliente para vender mesmo com restrição (override do admin). */
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

  /**
   * Avalia o cliente para criar um pedido. Usa uma consulta recente (dentro da
   * validade) ou consulta na hora. Erro de provedor NÃO bloqueia a venda.
   */
  async avaliarParaPedido(clienteId: number, empresaId: number, usuario: string) {
    if (!this.bloqueiaPedido) return { permitido: true, situacao: 'regular', motivo: 'Bloqueio de crédito desativado.' };
    const cliente = await this.getCliente(clienteId, empresaId);
    if (cliente.creditoLiberado) {
      return { permitido: true, situacao: 'liberado', motivo: `Crédito liberado pelo admin (${cliente.creditoLiberadoPor ?? '—'}).` };
    }

    // Reaproveita consulta recente; senão, consulta agora.
    const limite = new Date(Date.now() - this.validadeDias * 86400000);
    let consulta = await this.prisma.consultaCredito.findFirst({
      where: { clienteId, consultadoEm: { gte: limite } },
      orderBy: { consultadoEm: 'desc' },
    });
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
  private async consultarProvedor(doc: string): Promise<Resultado> {
    const apiUrl = this.config.get<string>('CREDITO_API_URL');
    if (apiUrl) return this.externo(apiUrl, doc);
    if (doc.length === 14) return this.brasilApi(doc);
    return this.simulado(doc);
  }

  /** BrasilAPI — situação cadastral do CNPJ na Receita (grátis, sem token). */
  private async brasilApi(cnpj: string): Promise<Resultado> {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return { situacao: 'erro', score: null, fonte: 'brasilapi', resumo: `Não foi possível consultar o CNPJ (HTTP ${res.status}).` };
      }
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

  /** Provedor externo genérico (ex.: Serasa via revendedor). Mapeia score/situação. */
  private async externo(url: string, doc: string): Promise<Resultado> {
    const token = this.config.get<string>('CREDITO_API_TOKEN');
    try {
      const res = await fetch(url.replace('{doc}', doc) + (url.includes('{doc}') ? '' : `?documento=${doc}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { situacao: 'erro', score: null, fonte: 'externo', resumo: `Provedor de crédito HTTP ${res.status}.` };
      const score = body['score'] != null ? Number(body['score']) : null;
      const temRestricao = body['restricao'] === true || (Array.isArray(body['restricoes']) && (body['restricoes'] as unknown[]).length > 0) || (score != null && score < 500);
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
  private simulado(doc: string): Resultado {
    const base = doc ? parseInt(doc.slice(-3), 10) || 0 : 500;
    const score = 300 + (base % 701); // 300..1000
    const regular = score >= 500;
    return {
      situacao: regular ? 'regular' : 'restricao',
      score,
      fonte: 'simulado',
      resumo: `Score simulado ${score} (${regular ? 'sem restrição' : 'com restrição'}) — configure a Serasa p/ dados reais.`,
    };
  }
}
