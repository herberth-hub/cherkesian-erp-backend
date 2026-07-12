import { Injectable, NotFoundException } from '@nestjs/common';
import { Comissao, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComissaoDto } from './dto/create-comissao.dto';
import { UpdateComissaoDto } from './dto/update-comissao.dto';
import { calcularStatusTitulo } from './titulo-status.util';

const D = (n: Prisma.Decimal.Value = 0) => new Prisma.Decimal(n);

/** Alíquotas simplificadas do Lucro Presumido (indústria/comércio) — estimativa. */
const LUCRO_PRESUMIDO = {
  pis: 0.0065,
  cofins: 0.03,
  presuncaoIRPJ: 0.08,
  aliqIRPJ: 0.15,
  presuncaoCSLL: 0.12,
  aliqCSLL: 0.09,
};

@Injectable()
export class FinanceiroService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fluxo de caixa: realizado + projeção (aberto) e buckets por vencimento. */
  async fluxo(empresaId: number) {
    const [receber, pagar] = await Promise.all([
      this.prisma.contaReceber.findMany({ where: { empresaId } }),
      this.prisma.contaPagar.findMany({ where: { empresaId } }),
    ]);
    const hoje = new Date();

    const recebido = receber.reduce((s, t) => s.plus(t.pago), D());
    const aReceberAberto = receber.reduce((s, t) => s.plus(t.valor.minus(t.pago)), D());
    const pago = pagar.reduce((s, t) => s.plus(t.pago), D());
    const aPagarAberto = pagar.reduce((s, t) => s.plus(t.valor.minus(t.pago)), D());

    const bucket = (titulos: { valor: Prisma.Decimal; pago: Prisma.Decimal; vencimento: Date }[]) => {
      const b = { vencida: D(), vencendo: D(), a_vencer: D() };
      for (const t of titulos) {
        const st = calcularStatusTitulo(t.valor, t.pago, t.vencimento, hoje);
        if (st === 'pago') continue;
        const saldo = t.valor.minus(t.pago);
        if (st === 'vencida') b.vencida = b.vencida.plus(saldo);
        else if (st === 'vencendo') b.vencendo = b.vencendo.plus(saldo);
        else b.a_vencer = b.a_vencer.plus(saldo);
      }
      return { vencida: b.vencida.toFixed(2), vencendo: b.vencendo.toFixed(2), a_vencer: b.a_vencer.toFixed(2) };
    };

    const saldoRealizado = recebido.minus(pago);
    const saldoProjetado = saldoRealizado.plus(aReceberAberto).minus(aPagarAberto);

    return {
      realizado: {
        recebido: recebido.toFixed(2),
        pago: pago.toFixed(2),
        saldo: saldoRealizado.toFixed(2),
      },
      aberto: {
        aReceber: aReceberAberto.toFixed(2),
        aPagar: aPagarAberto.toFixed(2),
      },
      saldoProjetado: saldoProjetado.toFixed(2),
      receberPorVencimento: bucket(receber),
      pagarPorVencimento: bucket(pagar),
    };
  }

  // ===== Comissões =====

  listarComissoes(empresaId: number): Promise<Comissao[]> {
    return this.prisma.comissao.findMany({
      where: { empresaId },
      orderBy: { id: 'desc' },
    });
  }

  async criarComissao(dto: CreateComissaoDto, empresaId: number): Promise<Comissao> {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId } });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${dto.pedidoId} não encontrado.`);
    }
    const valorVenda = D(dto.valorVenda);
    const percentual = D(dto.percentual);
    const comissao = dto.comissao != null ? D(dto.comissao) : valorVenda.mul(percentual);
    return this.prisma.comissao.create({
      data: {
        empresaId,
        pedidoId: dto.pedidoId,
        vendedor: dto.vendedor,
        valorVenda,
        percentual,
        comissao,
        statusPgto: 'A pagar',
      },
    });
  }

  async pagarComissao(id: number, empresaId: number): Promise<Comissao> {
    const comissao = await this.prisma.comissao.findUnique({ where: { id } });
    if (!comissao || comissao.empresaId !== empresaId) {
      throw new NotFoundException(`Comissão ${id} não encontrada.`);
    }
    return this.prisma.comissao.update({ where: { id }, data: { statusPgto: 'Pago' } });
  }

  async editarComissao(id: number, dto: UpdateComissaoDto, empresaId: number): Promise<Comissao> {
    const c = await this.prisma.comissao.findUnique({ where: { id } });
    if (!c || c.empresaId !== empresaId) {
      throw new NotFoundException(`Comissão ${id} não encontrada.`);
    }
    const valorVenda = dto.valorVenda != null ? D(dto.valorVenda) : c.valorVenda;
    const percentual = dto.percentual != null ? D(dto.percentual) : c.percentual;
    // Recalcula a comissão quando venda/percentual mudam e a comissão não veio explícita.
    let comissao = c.comissao;
    if (dto.comissao != null) comissao = D(dto.comissao);
    else if (dto.valorVenda != null || dto.percentual != null) comissao = valorVenda.mul(percentual);
    return this.prisma.comissao.update({
      where: { id },
      data: {
        vendedor: dto.vendedor ?? c.vendedor,
        valorVenda,
        percentual,
        comissao,
        statusPgto: dto.statusPgto ?? c.statusPgto,
      },
    });
  }

  async excluirComissao(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    const c = await this.prisma.comissao.findUnique({ where: { id } });
    if (!c || c.empresaId !== empresaId) {
      throw new NotFoundException(`Comissão ${id} não encontrada.`);
    }
    await this.prisma.comissao.delete({ where: { id } });
    return { removido: true, id };
  }

  // ===== Impostos (estimativa) =====

  /** Estimativa de impostos federais (Lucro Presumido) sobre o faturamento dos pedidos. */
  async impostos(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    const pedidos = await this.prisma.pedido.findMany({
      where: { empresaId },
      select: { valorTotal: true },
    });
    const faturamento = pedidos.reduce((s, p) => s.plus(p.valorTotal), D());

    const pis = faturamento.mul(LUCRO_PRESUMIDO.pis);
    const cofins = faturamento.mul(LUCRO_PRESUMIDO.cofins);
    const irpj = faturamento.mul(LUCRO_PRESUMIDO.presuncaoIRPJ).mul(LUCRO_PRESUMIDO.aliqIRPJ);
    const csll = faturamento.mul(LUCRO_PRESUMIDO.presuncaoCSLL).mul(LUCRO_PRESUMIDO.aliqCSLL);
    const total = pis.plus(cofins).plus(irpj).plus(csll);

    return {
      regime: empresa?.regime ?? 'Lucro Presumido',
      faturamento: faturamento.toFixed(2),
      tributos: {
        pis: pis.toFixed(2),
        cofins: cofins.toFixed(2),
        irpj: irpj.toFixed(2),
        csll: csll.toFixed(2),
      },
      totalEstimado: total.toFixed(2),
      cargaEfetiva: faturamento.isZero() ? '0.00%' : total.div(faturamento).mul(100).toFixed(2) + '%',
      observacao:
        'Estimativa de tributos federais no Lucro Presumido. Não inclui ICMS/ISS nem retenções; consulte a contabilidade.',
    };
  }
}
