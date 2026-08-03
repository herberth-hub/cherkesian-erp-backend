import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContaRecorrenteDto } from './dto/create-conta-recorrente.dto';
import { calcularStatusTitulo } from './titulo-status.util';

/** Contas fixas/recorrentes (aluguel, luz, água, internet…) que geram um título a pagar por mês. */
@Injectable()
export class ContasRecorrentesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number) {
    return this.prisma.contaRecorrente.findMany({
      where: { empresaId },
      orderBy: [{ ativa: 'desc' }, { categoria: 'asc' }],
    });
  }

  async create(dto: CreateContaRecorrenteDto, empresaId: number) {
    let filialId = dto.filialId;
    if (!filialId) {
      const matriz = await this.prisma.filial.findFirst({
        where: { empresaId },
        orderBy: [{ matriz: 'desc' }, { id: 'asc' }],
      });
      filialId = matriz?.id;
    }
    const dia = Math.min(31, Math.max(1, Math.round(dto.diaVencimento)));
    return this.prisma.contaRecorrente.create({
      data: {
        empresaId,
        filialId,
        fornecedorId: dto.fornecedorId,
        categoria: dto.categoria,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        diaVencimento: dia,
        ativa: dto.ativa ?? true,
      },
    });
  }

  async setAtiva(id: number, empresaId: number, ativa: boolean) {
    const r = await this.prisma.contaRecorrente.findUnique({ where: { id } });
    if (!r || r.empresaId !== empresaId) throw new NotFoundException(`Recorrente ${id} não encontrada.`);
    return this.prisma.contaRecorrente.update({ where: { id }, data: { ativa } });
  }

  async remover(id: number, empresaId: number) {
    const r = await this.prisma.contaRecorrente.findUnique({ where: { id } });
    if (!r || r.empresaId !== empresaId) throw new NotFoundException(`Recorrente ${id} não encontrada.`);
    await this.prisma.contaRecorrente.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Gera os títulos a pagar do mês corrente para todas as recorrentes ativas,
   * pulando as que já foram geradas (dedup por recorrenteId + mês do vencimento).
   */
  async gerarDoMes(empresaId: number, refDate: Date): Promise<{ criados: number }> {
    const ano = refDate.getUTCFullYear();
    const mes = refDate.getUTCMonth(); // 0-based
    const ini = new Date(Date.UTC(ano, mes, 1));
    const fim = new Date(Date.UTC(ano, mes + 1, 1));
    const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();

    const recs = await this.prisma.contaRecorrente.findMany({ where: { empresaId, ativa: true } });
    let criados = 0;
    for (const r of recs) {
      const jaTem = await this.prisma.contaPagar.findFirst({
        where: { recorrenteId: r.id, vencimento: { gte: ini, lt: fim } },
        select: { id: true },
      });
      if (jaTem) continue;
      const dia = Math.min(r.diaVencimento, ultimoDia);
      const vencimento = new Date(Date.UTC(ano, mes, dia));
      await this.prisma.contaPagar.create({
        data: {
          empresaId,
          filialId: r.filialId ?? undefined,
          fornecedorId: r.fornecedorId ?? undefined,
          categoria: r.categoria,
          referencia: r.descricao ?? undefined,
          vencimento,
          valor: r.valor,
          pago: 0,
          recorrenteId: r.id,
          status: calcularStatusTitulo(r.valor, new Prisma.Decimal(0), vencimento),
        },
      });
      criados++;
    }
    return { criados };
  }
}
