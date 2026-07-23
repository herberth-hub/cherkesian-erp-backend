import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const H = 3_600_000; // ms por hora

@Injectable()
export class BiService {
  constructor(private readonly prisma: PrismaService) {}

  /** BI de produtividade da cadeia produtiva (corte → facção → retorno → expedição). */
  async producao(empresaId: number) {
    const [pedidos, ops, kits, filiais, notas] = await Promise.all([
      this.prisma.pedido.findMany({ where: { empresaId }, select: { etapa: true, valorTotal: true, filialId: true, prazoEntrega: true } }),
      this.prisma.oP.findMany({ where: { pedido: { empresaId } }, select: { status: true, quantidade: true, entregaPrev: true } }),
      this.prisma.kit.findMany({ where: { empresaId }, select: { status: true, tamanho: true, modelo: true, pecasTotal: true, faccaoNome: true, dataCorte: true, expedidoEm: true, retornadoEm: true, criadoEm: true } }),
      this.prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true, matriz: true } }),
      this.prisma.notaFiscal.findMany({ where: { empresaId, status: 'autorizada' }, select: { filialId: true, valor: true, emitidaEm: true } }),
    ]);

    const agora = new Date();
    const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
    const matriz = filiais.find((f) => f.matriz) ?? filiais[0];

    // ===== Visão geral =====
    const opsAtivas = ops.filter((o) => o.status !== 'concluido').length;
    const opsConcluidas = ops.filter((o) => o.status === 'concluido').length;
    const kitsFinalizados = kits.filter((k) => k.status === 'finalizado');
    const pecasProduzidas = kitsFinalizados.reduce((s, k) => s + k.pecasTotal, 0);

    // ===== Gargalos (kits por etapa) =====
    const porEtapaKits: Record<string, number> = {};
    for (const k of kits) porEtapaKits[k.status] = (porEtapaKits[k.status] ?? 0) + 1;

    // ===== Lead time médio (horas) =====
    const media = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const corteExp = kits.filter((k) => k.dataCorte && k.expedidoEm).map((k) => (+new Date(k.expedidoEm!) - +new Date(k.dataCorte!)) / H);
    const emFaccaoDur = kits.filter((k) => k.expedidoEm && k.retornadoEm).map((k) => (+new Date(k.retornadoEm!) - +new Date(k.expedidoEm!)) / H);
    const leadTime = {
      corteAExpedicaoH: Number(media(corteExp).toFixed(1)),
      emFaccaoH: Number(media(emFaccaoDur).toFixed(1)),
      amostraCorteExp: corteExp.length,
      amostraFaccao: emFaccaoDur.length,
    };

    // ===== Por facção (produtividade) =====
    const facMap = new Map<string, { emFaccao: number; retornados: number; durs: number[] }>();
    for (const k of kits) {
      if (!k.faccaoNome) continue;
      const f = facMap.get(k.faccaoNome) ?? { emFaccao: 0, retornados: 0, durs: [] };
      if (k.status === 'em_faccao') f.emFaccao++;
      if (k.retornadoEm) { f.retornados++; if (k.expedidoEm) f.durs.push((+new Date(k.retornadoEm) - +new Date(k.expedidoEm)) / H); }
      facMap.set(k.faccaoNome, f);
    }
    const porFaccao = [...facMap.entries()].map(([faccao, v]) => ({
      faccao, emFaccao: v.emFaccao, retornados: v.retornados, tempoMedioHoras: Number(media(v.durs).toFixed(1)),
    })).sort((a, b) => b.emFaccao - a.emFaccao);

    // ===== Por modelo e por tamanho =====
    const modMap = new Map<string, { kits: number; pecas: number }>();
    const tamMap: Record<string, number> = {};
    for (const k of kits) {
      const m = k.modelo ?? '—';
      const x = modMap.get(m) ?? { kits: 0, pecas: 0 };
      x.kits++; x.pecas += k.pecasTotal; modMap.set(m, x);
      tamMap[k.tamanho] = (tamMap[k.tamanho] ?? 0) + k.pecasTotal;
    }
    const porModelo = [...modMap.entries()].map(([modelo, v]) => ({ modelo, ...v })).sort((a, b) => b.pecas - a.pecas).slice(0, 12);

    // ===== Atrasos =====
    const opsAtrasadas = ops.filter((o) => o.status !== 'concluido' && o.entregaPrev && new Date(o.entregaPrev) < agora).length;
    const pedidosAtrasados = pedidos.filter((p) => p.etapa !== 'expedicao' && p.prazoEntrega && new Date(p.prazoEntrega) < agora).length;

    // ===== Faturamento × produção por empresa =====
    const fatMap = new Map<number, number>();
    for (const n of notas) {
      const fid = n.filialId ?? matriz?.id ?? 0;
      fatMap.set(fid, (fatMap.get(fid) ?? 0) + Number(n.valor));
    }
    const faturamentoVsProducao = filiais.map((f) => ({
      empresa: f.nome,
      faturamentoNfe: Number((fatMap.get(f.id) ?? 0).toFixed(2)),
    }));

    // ===== Produtividade mensal (últimos 6 meses) =====
    const meses: { mes: string; pecas: number; kits: number; faturamento: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const fim = new Date(agora.getFullYear(), agora.getMonth() - i + 1, 1);
      const rot = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      const kMes = kitsFinalizados.filter((k) => k.retornadoEm && new Date(k.retornadoEm) >= d && new Date(k.retornadoEm) < fim);
      const fatMes = notas.filter((n) => n.emitidaEm && new Date(n.emitidaEm) >= d && new Date(n.emitidaEm) < fim).reduce((s, n) => s + Number(n.valor), 0);
      meses.push({ mes: rot, kits: kMes.length, pecas: kMes.reduce((s, k) => s + k.pecasTotal, 0), faturamento: Number(fatMes.toFixed(2)) });
    }

    return {
      geral: {
        pedidos: pedidos.length,
        opsAtivas, opsConcluidas,
        kitsTotal: kits.length,
        kitsFinalizados: kitsFinalizados.length,
        pecasProduzidas,
      },
      leadTime,
      porEtapaKits,
      porFaccao,
      porModelo,
      porTamanho: tamMap,
      atrasos: { opsAtrasadas, pedidosAtrasados },
      faturamentoVsProducao,
      produtividadeMensal: meses,
      observacao: 'Indicadores calculados a partir de pedidos, OPs, kits e NF-e. Quanto mais o fluxo de kits for usado, mais preciso o lead time por etapa.',
    };
  }
}
