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
    const [filiais, pedidos] = await Promise.all([
      this.prisma.filial.findMany({ where: { empresaId }, orderBy: [{ matriz: 'desc' }, { nome: 'asc' }] }),
      this.prisma.pedido.findMany({ where: { empresaId }, select: { filialId: true, valorTotal: true } }),
    ]);
    const matriz = filiais.find((f) => f.matriz) ?? filiais[0];
    const regimeLabel: Record<string, string> = {
      lucro_real: 'Lucro Real',
      lucro_presumido: 'Lucro Presumido',
      simples: 'Simples Nacional',
    };

    const porEmpresa = filiais.map((f) => {
      const fat = pedidos
        .filter((p) => p.filialId === f.id || (p.filialId == null && matriz && f.id === matriz.id))
        .reduce((s, p) => s.plus(p.valorTotal), D());
      const regime = f.regimeTributario ?? 'lucro_presumido';
      let pis = D(), cofins = D(), irpj = D(), csll = D();
      let nota = '';
      if (regime === 'simples') {
        nota = 'Simples Nacional: PIS/COFINS/ICMS/IRPJ/CSLL recolhidos no DAS unificado, conforme a faixa do anexo. Consulte a contabilidade.';
      } else {
        const pisAliq = f.pisAliquota != null ? Number(f.pisAliquota) / 100 : (regime === 'lucro_real' ? 0.0165 : LUCRO_PRESUMIDO.pis);
        const cofinsAliq = f.cofinsAliquota != null ? Number(f.cofinsAliquota) / 100 : (regime === 'lucro_real' ? 0.076 : LUCRO_PRESUMIDO.cofins);
        pis = fat.mul(pisAliq);
        cofins = fat.mul(cofinsAliq);
        if (regime === 'lucro_presumido') {
          irpj = fat.mul(LUCRO_PRESUMIDO.presuncaoIRPJ).mul(LUCRO_PRESUMIDO.aliqIRPJ);
          csll = fat.mul(LUCRO_PRESUMIDO.presuncaoCSLL).mul(LUCRO_PRESUMIDO.aliqCSLL);
          nota = 'Lucro Presumido (cumulativo): PIS 0,65% · COFINS 3% · IRPJ 8%×15% · CSLL 12%×9%. Sem ICMS/ISS.';
        } else {
          nota = 'Lucro Real (não-cumulativo): PIS 1,65% · COFINS 7,6%. IRPJ/CSLL incidem sobre o lucro real (apuração contábil), não estimados aqui.';
        }
      }
      const total = pis.plus(cofins).plus(irpj).plus(csll);
      return {
        id: f.id,
        nome: f.nome,
        cnpj: f.cnpj,
        matriz: f.matriz,
        regime: regimeLabel[regime] ?? regime,
        regimeCod: regime,
        faturamento: fat.toFixed(2),
        tributos: { pis: pis.toFixed(2), cofins: cofins.toFixed(2), irpj: irpj.toFixed(2), csll: csll.toFixed(2) },
        totalEstimado: total.toFixed(2),
        cargaEfetiva: fat.isZero() ? '0.00%' : total.div(fat).mul(100).toFixed(2) + '%',
        nota,
      };
    });

    const faturamentoTotal = porEmpresa.reduce((s, e) => s.plus(e.faturamento), D());
    const totalEstimado = porEmpresa.reduce((s, e) => s.plus(e.totalEstimado), D());
    return {
      porEmpresa,
      faturamentoTotal: faturamentoTotal.toFixed(2),
      totalEstimado: totalEstimado.toFixed(2),
      observacao: 'Estimativa de tributos federais por empresa/CNPJ conforme o regime cadastrado em Filiais. Não inclui ICMS/ISS nem retenções; confirme com a contabilidade.',
    };
  }
}
