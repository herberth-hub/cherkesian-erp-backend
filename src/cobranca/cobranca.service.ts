import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const DIA = 86_400_000;

interface TituloAberto {
  id: number;
  documento: string | null;
  vencimento: Date;
  saldo: number;
  diasAtraso: number;
  filialId: number | null;
  ultimaCobrancaEm: Date | null;
}

export interface CobrancaConfigInput {
  automatico?: boolean;
  diasAtraso?: number;
  intervaloDias?: number;
  horario?: string;
  copiaPara?: string | null;
  assinatura?: string | null;
}

/**
 * Régua de cobrança por e-mail dos títulos EM ABERTO (a receber).
 * Modo assistido (o financeiro revisa e dispara) + automático diário opcional
 * (ligado na config). Só cobra títulos vencidos há >= diasAtraso e respeita o
 * intervalo de reenvio. Tom cordial.
 */
@Injectable()
export class CobrancaService implements OnModuleInit {
  private readonly logger = new Logger(CobrancaService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  // ===== Agendador leve (sem dependência): confere a cada 15 min =====
  onModuleInit() {
    this.timer = setInterval(() => this.tickAutomatico().catch((e) => this.logger.error(String(e))), 15 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  private async tickAutomatico() {
    const configs = await this.prisma.cobrancaConfig.findMany({ where: { automatico: true } });
    if (!configs.length) return;
    const agora = new Date();
    const hojeKey = agora.toISOString().slice(0, 10);
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    for (const cfg of configs) {
      const [h, m] = (cfg.horario || '08:00').split(':').map((x) => Number(x));
      const alvo = (h || 0) * 60 + (m || 0);
      const jaRodouHoje = cfg.ultimoRunEm && cfg.ultimoRunEm.toISOString().slice(0, 10) === hojeKey;
      if (!jaRodouHoje && minutosAgora >= alvo) {
        this.logger.log(`Executando régua de cobrança automática (empresa ${cfg.empresaId}).`);
        await this.enviar(cfg.empresaId, undefined, false, true).catch((e) => this.logger.error(String(e)));
      }
    }
  }

  // ===== Config =====
  async getConfig(empresaId: number) {
    const c = await this.prisma.cobrancaConfig.findUnique({ where: { empresaId } });
    return (
      c ?? {
        empresaId, automatico: false, diasAtraso: 3, intervaloDias: 7,
        horario: '08:00', copiaPara: null, assinatura: null, ultimoRunEm: null,
      }
    );
  }

  async saveConfig(empresaId: number, dto: CobrancaConfigInput) {
    const data = {
      automatico: dto.automatico ?? undefined,
      diasAtraso: dto.diasAtraso != null ? Math.max(0, Math.floor(dto.diasAtraso)) : undefined,
      intervaloDias: dto.intervaloDias != null ? Math.max(1, Math.floor(dto.intervaloDias)) : undefined,
      horario: dto.horario ?? undefined,
      copiaPara: dto.copiaPara !== undefined ? (dto.copiaPara?.trim() || null) : undefined,
      assinatura: dto.assinatura !== undefined ? (dto.assinatura?.trim() || null) : undefined,
    };
    return this.prisma.cobrancaConfig.upsert({
      where: { empresaId },
      update: data,
      create: { empresaId, ...data, automatico: dto.automatico ?? false },
    });
  }

  // ===== Núcleo: quem está em aberto e elegível =====
  private diasAtrasoDe(venc: Date, hoje: Date): number {
    const dv = Date.UTC(venc.getUTCFullYear(), venc.getUTCMonth(), venc.getUTCDate());
    const d0 = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
    return Math.round((d0 - dv) / DIA);
  }

  /** Agrupa por cliente os títulos vencidos há >= diasAtraso, com elegibilidade de reenvio. */
  async pendentes(empresaId: number) {
    const cfg = await this.getConfig(empresaId);
    const hoje = new Date();
    const titulos = await this.prisma.contaReceber.findMany({
      where: { empresaId, status: { not: 'pago' } },
      select: { id: true, clienteId: true, documento: true, vencimento: true, valor: true, pago: true, filialId: true, ultimaCobrancaEm: true },
    });
    const clientesIds = [...new Set(titulos.map((t) => t.clienteId))];
    const clientes = await this.prisma.cliente.findMany({ where: { id: { in: clientesIds } }, select: { id: true, nome: true, email: true, cnpjCpf: true } });
    const cliMap = new Map(clientes.map((c) => [c.id, c]));

    const grupos = new Map<number, TituloAberto[]>();
    for (const t of titulos) {
      const dias = this.diasAtrasoDe(t.vencimento, hoje);
      if (dias < cfg.diasAtraso) continue; // ainda não entrou na régua
      const saldo = Number(t.valor) - Number(t.pago);
      if (saldo <= 0.001) continue;
      const arr = grupos.get(t.clienteId) ?? [];
      arr.push({ id: t.id, documento: t.documento, vencimento: t.vencimento, saldo: Number(saldo.toFixed(2)), diasAtraso: dias, filialId: t.filialId, ultimaCobrancaEm: t.ultimaCobrancaEm });
      grupos.set(t.clienteId, arr);
    }

    const lista = [...grupos.entries()].map(([clienteId, ts]) => {
      const cli = cliMap.get(clienteId);
      const total = Number(ts.reduce((s, t) => s + t.saldo, 0).toFixed(2));
      const ultima = ts.reduce<Date | null>((acc, t) => (t.ultimaCobrancaEm && (!acc || t.ultimaCobrancaEm > acc) ? t.ultimaCobrancaEm : acc), null);
      const diasDesdeUltima = ultima ? Math.round((hoje.getTime() - ultima.getTime()) / DIA) : null;
      const podeEnviar = !ultima || (diasDesdeUltima ?? 0) >= cfg.intervaloDias;
      return {
        clienteId, nome: cli?.nome ?? `Cliente ${clienteId}`, cnpjCpf: cli?.cnpjCpf ?? null,
        email: cli?.email ?? null, temEmail: !!cli?.email,
        totalAberto: total, qtdTitulos: ts.length, maxAtraso: Math.max(...ts.map((t) => t.diasAtraso)),
        ultimaCobranca: ultima, diasDesdeUltima, podeEnviar,
        titulos: ts.sort((a, b) => b.diasAtraso - a.diasAtraso).map((t) => ({ id: t.id, documento: t.documento, vencimento: t.vencimento, saldo: t.saldo, diasAtraso: t.diasAtraso })),
      };
    });
    lista.sort((a, b) => b.totalAberto - a.totalAberto);
    return { config: cfg, totalClientes: lista.length, totalAberto: Number(lista.reduce((s, c) => s + c.totalAberto, 0).toFixed(2)), clientes: lista };
  }

  // ===== Montagem do e-mail (tom cordial) =====
  private async marcaEPix(empresaId: number, filialId: number | null): Promise<{ marca: string; pix: string }> {
    const fil = filialId
      ? await this.prisma.filial.findUnique({ where: { id: filialId }, select: { nome: true, nomeFantasia: true, dadosBancarios: true } })
      : await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, select: { nome: true, nomeFantasia: true, dadosBancarios: true } });
    const marca = (fil?.nomeFantasia || fil?.nome || 'GRUPO CHERKESIAN').trim();
    const linhaPix = String(fil?.dadosBancarios || '').split(/[\r\n]+/).map((l) => l.trim()).find((l) => /pix/i.test(l)) || '';
    return { marca, pix: linhaPix };
  }

  private brl(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private async montarMensagem(empresaId: number, cliente: { nome: string; email: string | null }, titulos: Array<{ documento: string | null; vencimento: Date; saldo: number; diasAtraso: number }>, filialId: number | null, assinatura?: string | null) {
    const { marca, pix } = await this.marcaEPix(empresaId, filialId);
    const total = titulos.reduce((s, t) => s + t.saldo, 0);
    const linhas = titulos
      .map((t) => `• ${t.documento ? 'Doc ' + t.documento + ' — ' : ''}venc. ${t.vencimento.toISOString().slice(0, 10).split('-').reverse().join('/')} — ${this.brl(t.saldo)} (${t.diasAtraso} dia(s) em atraso)`)
      .join('\n');
    const assunto = `Lembrete de pagamento — ${marca}`;
    const corpo =
      `Olá, ${cliente.nome}.\n\n` +
      `Passando para lembrar, de forma cordial, sobre ${titulos.length === 1 ? 'o título' : 'os títulos'} em aberto conosco:\n\n` +
      `${linhas}\n\n` +
      `Total em aberto: ${this.brl(total)}.\n\n` +
      (pix ? `Para facilitar, o pagamento pode ser feito via ${pix}\n\n` : '') +
      `Se já efetuou o pagamento, por favor desconsidere este e-mail e, se possível, nos envie o comprovante. Qualquer dúvida sobre boletos, valores ou datas, estamos à disposição.\n\n` +
      `Agradecemos pela parceria!\n\n` +
      `${(assinatura || '').trim() || `${marca}\nFinanceiro`}`;
    return { assunto, corpo, marca };
  }

  /** Prévia do e-mail que seria enviado a um cliente (sem enviar). */
  async preview(empresaId: number, clienteId: number) {
    const dados = await this.pendentes(empresaId);
    const c = dados.clientes.find((x) => x.clienteId === clienteId);
    if (!c) return { encontrado: false as const, motivo: 'Cliente sem títulos elegíveis na régua.' };
    const filialId = c.titulos[0] ? (await this.prisma.contaReceber.findUnique({ where: { id: c.titulos[0].id }, select: { filialId: true } }))?.filialId ?? null : null;
    const cfg = await this.getConfig(empresaId);
    const msg = await this.montarMensagem(empresaId, { nome: c.nome, email: c.email }, c.titulos, filialId, cfg.assinatura);
    return { encontrado: true as const, para: c.email, temEmail: c.temEmail, ...msg };
  }

  /**
   * Dispara a cobrança. Sem clienteIds, considera TODOS os elegíveis (respeitando
   * o intervalo, salvo force). `auto` marca a execução da régua (atualiza ultimoRunEm).
   */
  async enviar(empresaId: number, clienteIds?: number[], force = false, auto = false) {
    const dados = await this.pendentes(empresaId);
    const cfg = await this.getConfig(empresaId);
    let alvo = dados.clientes;
    if (clienteIds && clienteIds.length) alvo = alvo.filter((c) => clienteIds.includes(c.clienteId));
    if (!force) alvo = alvo.filter((c) => c.podeEnviar);

    const enviados: string[] = [];
    const semEmail: string[] = [];
    const falhas: string[] = [];
    for (const c of alvo) {
      if (!c.temEmail || !c.email) { semEmail.push(c.nome); continue; }
      const filialId = c.titulos[0] ? (await this.prisma.contaReceber.findUnique({ where: { id: c.titulos[0].id }, select: { filialId: true } }))?.filialId ?? null : null;
      const msg = await this.montarMensagem(empresaId, { nome: c.nome, email: c.email }, c.titulos, filialId, cfg.assinatura);
      const destino = cfg.copiaPara ? `${c.email}, ${cfg.copiaPara}` : c.email;
      const r = await this.email.enviar({ para: destino, remetenteNome: msg.marca, assunto: msg.assunto, texto: msg.corpo });
      if (r.enviado) {
        enviados.push(c.nome);
        await this.prisma.contaReceber.updateMany({
          where: { id: { in: c.titulos.map((t) => t.id) } },
          data: { ultimaCobrancaEm: new Date(), cobrancasEnviadas: { increment: 1 } },
        });
      } else {
        falhas.push(c.nome);
      }
    }
    if (auto) await this.prisma.cobrancaConfig.update({ where: { empresaId }, data: { ultimoRunEm: new Date() } }).catch(() => undefined);
    return { enviados: enviados.length, semEmail: semEmail.length, falhas: falhas.length, detalhe: { enviados, semEmail, falhas } };
  }
}
