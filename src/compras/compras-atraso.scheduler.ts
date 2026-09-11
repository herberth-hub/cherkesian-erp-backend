import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { EmailService } from '../email/email.service';

/**
 * Fase 3 — ATRASO de recebimento de compra: todo dia (07:00) varre as OCs PAGAS
 * (aguardando recebimento) cuja PREVISÃO de entrega já passou e ainda não chegaram.
 * Para cada empresa:
 *  - notifica o COMPRADOR na tela (ciência obrigatória, área "compras");
 *  - avisa o FORNECEDOR por e-mail (se tiver e-mail e SMTP configurado).
 * Dedupe: re-avisa no máximo a cada 3 dias por OC (atrasoAvisadoEm).
 * Agendador interno (setTimeout reprogramado), sem dependência externa.
 */
@Injectable()
export class ComprasAtrasoScheduler implements OnModuleInit {
  private readonly logger = new Logger('ComprasAtraso');
  private readonly REAVISO_DIAS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacoes: NotificacoesService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    this.agendarProximo();
  }

  private agendarProximo() {
    const agora = new Date();
    const alvo = new Date(agora);
    alvo.setHours(7, 0, 0, 0);
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);
    const ms = Math.max(60_000, alvo.getTime() - agora.getTime());
    const t = setTimeout(() => {
      this.rodar()
        .catch((e) => this.logger.error(e?.message ?? String(e)))
        .finally(() => this.agendarProximo());
    }, ms);
    if (typeof t.unref === 'function') t.unref();
  }

  /** Varre as OCs pagas atrasadas e dispara os avisos (comprador + fornecedor). */
  async rodar(): Promise<void> {
    const agora = new Date();
    const limiteReaviso = new Date(agora.getTime() - this.REAVISO_DIAS * 24 * 60 * 60 * 1000);
    const empresas = await this.prisma.empresa.findMany({ select: { id: true, nome: true } });
    for (const emp of empresas) {
      const atrasadas = await this.prisma.ordemCompra.findMany({
        where: {
          status: 'aguardando',
          situacao: 'pago',
          previsaoEntrega: { lt: agora },
          fornecedor: { empresaId: emp.id },
          OR: [{ atrasoAvisadoEm: null }, { atrasoAvisadoEm: { lt: limiteReaviso } }],
        },
        select: { id: true, numero: true, descricao: true, previsaoEntrega: true, valor: true, fornecedor: { select: { nome: true, email: true } } },
        orderBy: { previsaoEntrega: 'asc' },
      });
      if (!atrasadas.length) continue;

      const dias = (d: Date | null) => (d ? Math.max(0, Math.ceil((agora.getTime() - d.getTime()) / 86400000)) : 0);
      // 1) Notificação com ciência p/ o comprador (área compras/pcp).
      const linhas = atrasadas.slice(0, 15).map((o) => `${o.numero} · ${o.fornecedor?.nome ?? ''} · ${dias(o.previsaoEntrega)}d de atraso`).join(' | ');
      await this.notificacoes.criar(emp.id, {
        tipo: 'compra_atrasada',
        areas: ['compras', 'pcp'],
        titulo: `⏰ ${atrasadas.length} compra(s) atrasada(s)`,
        mensagem: `Ordens de compra pagas que passaram da previsão de entrega: ${linhas}${atrasadas.length > 15 ? '…' : ''}. Cobre o fornecedor.`,
      });

      // 2) E-mail ao fornecedor (uma cobrança por OC atrasada; simulado se SMTP não configurado).
      for (const o of atrasadas) {
        const dest = (o.fornecedor?.email ?? '').trim();
        if (dest) {
          await this.email
            .enviar({
              para: dest,
              assunto: `Cobrança de entrega — Ordem de Compra ${o.numero}`,
              texto:
                `Prezado(a) ${o.fornecedor?.nome ?? 'fornecedor'},\n\n` +
                `A Ordem de Compra ${o.numero} (${o.descricao}) está com a entrega ATRASADA em ${dias(o.previsaoEntrega)} dia(s) ` +
                `em relação à previsão combinada (${o.previsaoEntrega ? o.previsaoEntrega.toLocaleDateString('pt-BR') : '-'}).\n\n` +
                `Por gentileza, confirme a nova previsão de entrega.\n\n${emp.nome}`,
              remetenteNome: emp.nome,
            })
            .catch((e) => this.logger.warn(`Falha e-mail atraso OC ${o.numero}: ${(e as Error).message}`));
        }
        await this.prisma.ordemCompra.update({ where: { id: o.id }, data: { atrasoAvisadoEm: agora } }).catch(() => undefined);
      }
      this.logger.log(`Empresa ${emp.id}: ${atrasadas.length} OC(s) atrasada(s) avisada(s).`);
    }
  }
}
