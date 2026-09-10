import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Detecção automática AGENDADA de reposição: todo dia (06:00) varre os materiais
 * com saldo ABAIXO do mínimo e registra um alerta no Log (auditoria/rastro do que
 * o sistema detectou sozinho). Agendador interno, sem dependência externa — usa
 * setTimeout reprogramado a cada execução. O painel/login mostram o déficit ao vivo.
 */
@Injectable()
export class EstoqueAlertaScheduler implements OnModuleInit {
  private readonly logger = new Logger('EstoqueAlerta');

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.agendarProximo();
  }

  private agendarProximo() {
    const agora = new Date();
    const alvo = new Date(agora);
    alvo.setHours(6, 0, 0, 0);
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);
    const ms = Math.max(60_000, alvo.getTime() - agora.getTime());
    const t = setTimeout(() => {
      this.rodar()
        .catch((e) => this.logger.error(e?.message ?? String(e)))
        .finally(() => this.agendarProximo());
    }, ms);
    // Não segura o processo vivo por causa do timer.
    if (typeof t.unref === 'function') t.unref();
  }

  /** Varre os materiais abaixo do mínimo por empresa e grava o alerta no Log. */
  async rodar(): Promise<void> {
    const empresas = await this.prisma.empresa.findMany({ select: { id: true } });
    for (const e of empresas) {
      const mats = await this.prisma.material.findMany({
        where: { empresaId: e.id },
        select: { codigo: true, saldo: true, minimo: true },
      });
      const deficit = mats.filter((m) => Number(m.minimo) > 0 && Number(m.saldo) < Number(m.minimo));
      if (!deficit.length) continue;
      const lista = deficit.slice(0, 20).map((m) => m.codigo).join(', ');
      await this.prisma.log
        .create({
          data: {
            usuario: 'sistema',
            acao: 'alerta_estoque',
            detalhe: `${deficit.length} material(is) abaixo do mínimo: ${lista}${deficit.length > 20 ? '…' : ''}`,
            entidade: 'material',
          },
        })
        .catch(() => undefined);
      this.logger.log(`Empresa ${e.id}: ${deficit.length} material(is) abaixo do mínimo.`);
    }
  }
}
