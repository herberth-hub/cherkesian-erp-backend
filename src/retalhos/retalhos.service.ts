import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CriarRetalhoInput {
  descricao?: string;
  cor?: string;
  composicao?: string;
  pesoKg: number;
  localizacao?: string;
  origem?: string;
  filialId?: number;
}

/**
 * Retalhos de tecido (sobras do corte): pesados em kg, guardados no estoque e
 * reciclados no fim do mês. Estoque por PESO (não por peça).
 */
@Injectable()
export class RetalhosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista os retalhos guardados (não reciclados) + resumo por cor e total em kg. */
  async findAll(empresaId: number, incluirReciclados = false) {
    const where: Prisma.RetalhoWhereInput = incluirReciclados ? { empresaId } : { empresaId, reciclado: false };
    const lista = await this.prisma.retalho.findMany({ where, orderBy: { id: 'desc' } });
    const emEstoque = lista.filter((r) => !r.reciclado);
    const totalKg = Number(emEstoque.reduce((s, r) => s + Number(r.pesoKg), 0).toFixed(3));
    const porCor = new Map<string, number>();
    for (const r of emEstoque) {
      const k = (r.cor || '—').toUpperCase();
      porCor.set(k, Number((((porCor.get(k) ?? 0) + Number(r.pesoKg))).toFixed(3)));
    }
    return {
      totalKg,
      qtd: emEstoque.length,
      porCor: [...porCor.entries()].map(([cor, kg]) => ({ cor, kg })).sort((a, b) => b.kg - a.kg),
      itens: lista.map((r) => ({
        id: r.id, descricao: r.descricao, cor: r.cor, composicao: r.composicao,
        pesoKg: Number(r.pesoKg), localizacao: r.localizacao, origem: r.origem,
        reciclado: r.reciclado, recicladoEm: r.recicladoEm, criadoEm: r.criadoEm,
      })),
    };
  }

  /** Registra uma pesagem de retalho no estoque. */
  async create(dto: CriarRetalhoInput, empresaId: number, criadoPor: string) {
    const peso = Number(dto.pesoKg);
    if (!(peso > 0)) throw new BadRequestException('Informe o peso do retalho (kg > 0).');
    const descricao = (dto.descricao || '').trim() || (dto.cor ? `Retalho ${dto.cor}` : 'Retalho de tecido');
    return this.prisma.retalho.create({
      data: {
        empresaId,
        filialId: dto.filialId,
        descricao,
        cor: dto.cor?.trim() || null,
        composicao: dto.composicao?.trim() || null,
        pesoKg: new Prisma.Decimal(peso.toFixed(3)),
        localizacao: dto.localizacao?.trim() || null,
        origem: dto.origem?.trim() || null,
        criadoPor,
      },
    });
  }

  /** Reciclagem de fim de mês: baixa (marca reciclado) os retalhos informados,
   *  ou TODOS os em estoque quando nenhum id é passado. Retorna kg reciclados. */
  async reciclar(empresaId: number, ids?: number[]) {
    const where: Prisma.RetalhoWhereInput = { empresaId, reciclado: false, ...(ids && ids.length ? { id: { in: ids } } : {}) };
    const alvo = await this.prisma.retalho.findMany({ where, select: { id: true, pesoKg: true } });
    if (!alvo.length) throw new BadRequestException('Nenhum retalho em estoque para reciclar.');
    const kg = Number(alvo.reduce((s, r) => s + Number(r.pesoKg), 0).toFixed(3));
    await this.prisma.retalho.updateMany({ where: { id: { in: alvo.map((a) => a.id) } }, data: { reciclado: true, recicladoEm: new Date() } });
    return { reciclados: alvo.length, kg };
  }

  async remove(id: number, empresaId: number) {
    const r = await this.prisma.retalho.findUnique({ where: { id } });
    if (!r || r.empresaId !== empresaId) throw new NotFoundException(`Retalho ${id} não encontrado.`);
    await this.prisma.retalho.delete({ where: { id } });
    return { removido: true, id };
  }
}
