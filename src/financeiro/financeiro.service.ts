import { Injectable, NotFoundException } from '@nestjs/common';
import { Comissao, Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComissaoDto } from './dto/create-comissao.dto';
import { UpdateComissaoDto } from './dto/update-comissao.dto';
import { calcularStatusTitulo } from './titulo-status.util';

const D = (n: Prisma.Decimal.Value = 0) => new Prisma.Decimal(n);
/** Chave de dia (YYYY-MM-DD) de uma data, sem fuso — coerente com vencimentos gravados à meia-noite UTC. */
const diaKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
const brl = (v: Prisma.Decimal | number) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBRcurta = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };

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

  /**
   * Calendário de fluxo de caixa: entradas × saídas por dia no período, saldo acumulado
   * projetado e alertas de dias com déficit + sugestão de prorrogação para não faltar caixa.
   */
  async calendario(empresaId: number, de?: string, ate?: string) {
    // Janela padrão: mês corrente (referência = hoje ou o mês informado em `de`).
    const base = de ? new Date(de + 'T12:00:00') : new Date();
    const ini = de ? new Date(de + 'T00:00:00') : new Date(base.getFullYear(), base.getMonth(), 1);
    const fim = ate ? new Date(ate + 'T23:59:59') : new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59);
    const iniKey = diaKey(ini);
    const fimKey = diaKey(fim);
    const hojeKey = diaKey(new Date());

    const [receber, pagar, clientes, fornecedores] = await Promise.all([
      this.prisma.contaReceber.findMany({ where: { empresaId, status: { not: 'pago' } } }),
      this.prisma.contaPagar.findMany({ where: { empresaId, status: { not: 'pago' } } }),
      this.prisma.cliente.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
      this.prisma.fornecedor.findMany({ select: { id: true, nome: true } }),
    ]);
    const nomeCliente = new Map(clientes.map((c) => [c.id, c.nome]));
    const nomeFornecedor = new Map(fornecedores.map((f) => [f.id, f.nome]));

    // Vencidos (antes do início da janela) entram como obrigação/entrada imediata no 1º dia visível.
    const clampKey = (venc: Date) => { const k = diaKey(venc); return k < iniKey ? iniKey : k; };

    type Titulo = { id: number; data: string; venceuKey: string; valor: number; parte: string; atrasado: boolean };
    const dias = new Map<string, { entradas: Titulo[]; saidas: Titulo[] }>();
    const dia = (k: string) => { if (!dias.has(k)) dias.set(k, { entradas: [], saidas: [] }); return dias.get(k)!; };

    for (const t of receber) {
      const vk = diaKey(t.vencimento);
      if (vk > fimKey) continue; // fora da janela (futuro além do fim)
      const k = clampKey(t.vencimento);
      const saldo = Number(D(t.valor).minus(t.pago));
      if (saldo <= 0) continue;
      dia(k).entradas.push({ id: t.id, data: k, venceuKey: vk, valor: saldo, parte: nomeCliente.get(t.clienteId) ?? 'Cliente', atrasado: vk < hojeKey });
    }
    for (const t of pagar) {
      const vk = diaKey(t.vencimento);
      if (vk > fimKey) continue;
      const k = clampKey(t.vencimento);
      const saldo = Number(D(t.valor).minus(t.pago));
      if (saldo <= 0) continue;
      const nomeF = t.fornecedorId != null ? nomeFornecedor.get(t.fornecedorId) : undefined;
      dia(k).saidas.push({ id: t.id, data: k, venceuKey: vk, valor: saldo, parte: nomeF ?? t.categoria ?? 'Fornecedor', atrasado: vk < hojeKey });
    }

    // Saldo inicial = caixa realizado (recebido − pago já baixados).
    const [recTodos, pagTodos] = await Promise.all([
      this.prisma.contaReceber.aggregate({ where: { empresaId }, _sum: { pago: true } }),
      this.prisma.contaPagar.aggregate({ where: { empresaId }, _sum: { pago: true } }),
    ]);
    const saldoInicial = Number(D(recTodos._sum.pago ?? 0).minus(pagTodos._sum.pago ?? 0));

    // Monta a série diária contínua.
    const lista: Array<{ data: string; entrada: number; saida: number; liquido: number; saldoAcumulado: number; deficit: boolean; entradas: Titulo[]; saidas: Titulo[] }> = [];
    let acumulado = saldoInicial;
    for (let d = new Date(ini); diaKey(d) <= fimKey; d.setDate(d.getDate() + 1)) {
      const k = diaKey(d);
      const reg = dias.get(k) ?? { entradas: [], saidas: [] };
      const entrada = reg.entradas.reduce((s, x) => s + x.valor, 0);
      const saida = reg.saidas.reduce((s, x) => s + x.valor, 0);
      const liquido = entrada - saida;
      acumulado += liquido;
      lista.push({ data: k, entrada, saida, liquido, saldoAcumulado: acumulado, deficit: acumulado < -0.005, entradas: reg.entradas, saidas: reg.saidas });
    }

    const totalEntrada = lista.reduce((s, d) => s + d.entrada, 0);
    const totalSaida = lista.reduce((s, d) => s + d.saida, 0);

    // ===== Alertas e sugestões de prorrogação =====
    const alertas: Array<{ tipo: string; nivel: 'critico' | 'atencao'; data?: string; titulo: string; detalhe: string }> = [];

    // 1) Balanço do período: mais a pagar do que a receber.
    if (totalSaida > totalEntrada + 0.005) {
      alertas.push({
        tipo: 'saldo_periodo', nivel: 'atencao',
        titulo: 'Saídas maiores que entradas no período',
        detalhe: `No período há R$ ${brl(totalSaida)} a pagar contra R$ ${brl(totalEntrada)} a receber — diferença de R$ ${brl(totalSaida - totalEntrada)}. Avalie prorrogar pagamentos ou antecipar recebíveis.`,
      });
    }

    // 2) Dias em que o caixa fica negativo → sugere prorrogar pagamentos daquele dia
    //    para o próximo dia com folga (saldo acumulado positivo) na janela.
    const diasDeficit = lista.filter((d) => d.deficit);
    for (const d of diasDeficit) {
      const falta = Math.abs(d.saldoAcumulado);
      // próximo dia com folga suficiente para absorver a prorrogação
      const folga = lista.find((x) => x.data > d.data && x.saldoAcumulado - falta > -0.005);
      const alvo = folga ? folga.data : lista[lista.length - 1].data;
      // maiores pagamentos do dia como candidatos a prorrogar
      const candidatos = [...d.saidas].sort((a, b) => b.valor - a.valor).slice(0, 3);
      const nomes = candidatos.map((c) => `${c.parte} (R$ ${brl(c.valor)})`).join(', ');
      alertas.push({
        tipo: 'deficit_dia', nivel: 'critico', data: d.data,
        titulo: `Caixa negativo em ${dataBRcurta(d.data)}`,
        detalhe: `Saldo projetado de R$ ${brl(d.saldoAcumulado)}. Faltam R$ ${brl(falta)}. Sugestão: prorrogar ${nomes || 'pagamentos deste dia'} para ${dataBRcurta(alvo)}${folga ? '' : ' (ou além da janela)'}, quando há folga de caixa.`,
      });
    }

    return {
      periodo: { de: iniKey, ate: fimKey },
      saldoInicial: saldoInicial.toFixed(2),
      totais: { entrada: totalEntrada.toFixed(2), saida: totalSaida.toFixed(2), liquido: (totalEntrada - totalSaida).toFixed(2), saldoFinal: (lista.length ? lista[lista.length - 1].saldoAcumulado : saldoInicial).toFixed(2) },
      dias: lista.map((d) => ({
        data: d.data,
        entrada: d.entrada.toFixed(2),
        saida: d.saida.toFixed(2),
        liquido: d.liquido.toFixed(2),
        saldoAcumulado: d.saldoAcumulado.toFixed(2),
        deficit: d.deficit,
        entradas: d.entradas.map((x) => ({ id: x.id, valor: x.valor.toFixed(2), parte: x.parte, atrasado: x.atrasado })),
        saidas: d.saidas.map((x) => ({ id: x.id, valor: x.valor.toFixed(2), parte: x.parte, atrasado: x.atrasado })),
      })),
      alertas,
    };
  }

  /** Exporta o calendário de fluxo em Excel (.xlsx) com os tons da marca. */
  async calendarioXlsx(empresaId: number, de?: string, ate?: string): Promise<{ buffer: Buffer; nome: string }> {
    const cal = await this.calendario(empresaId, de, ate);
    const wb = new Workbook();
    wb.creator = 'Grupo Cherkesian · ERP';
    const ws = wb.addWorksheet('Fluxo de Caixa');

    ws.mergeCells(1, 1, 1, 6);
    const t = ws.getCell(1, 1);
    t.value = `Fluxo de Caixa — ${dataBRcurta(cal.periodo.de)} a ${dataBRcurta(cal.periodo.ate)}`;
    t.font = { bold: true, size: 14, color: { argb: 'FF1E2C48' } };
    ws.mergeCells(2, 1, 2, 6);
    ws.getCell(2, 1).value = `Saldo inicial: R$ ${brl(Number(cal.saldoInicial))}`;
    ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF807D72' } };

    const cols = ['Dia', 'Entradas (R$)', 'Saídas (R$)', 'Líquido (R$)', 'Saldo acumulado (R$)', 'Situação'];
    const hr = ws.getRow(4);
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2C48' } };
      cell.alignment = { horizontal: i === 0 ? 'left' : 'right' };
    });
    hr.commit();

    for (const d of cal.dias) {
      const r = ws.addRow([
        dataBRcurta(d.data),
        Number(d.entrada), Number(d.saida), Number(d.liquido), Number(d.saldoAcumulado),
        d.deficit ? 'CAIXA NEGATIVO' : (Number(d.saida) > Number(d.entrada) ? 'saída > entrada' : 'ok'),
      ]);
      for (let i = 2; i <= 5; i++) { r.getCell(i).numFmt = '#,##0.00'; r.getCell(i).alignment = { horizontal: 'right' }; }
      if (d.deficit) r.getCell(6).font = { bold: true, color: { argb: 'FFC14A34' } };
    }
    const tr = ws.addRow(['TOTAL', Number(cal.totais.entrada), Number(cal.totais.saida), Number(cal.totais.liquido), Number(cal.totais.saldoFinal), '']);
    tr.font = { bold: true };
    for (let i = 2; i <= 5; i++) { tr.getCell(i).numFmt = '#,##0.00'; tr.getCell(i).alignment = { horizontal: 'right' }; }

    if (cal.alertas.length) {
      ws.addRow([]);
      const ah = ws.addRow(['Alertas / sugestões de prorrogação']);
      ah.getCell(1).font = { bold: true, color: { argb: 'FF1E2C48' } };
      for (const a of cal.alertas) {
        const ar = ws.addRow([`${a.nivel === 'critico' ? '⛔' : '⚠️'} ${a.titulo}: ${a.detalhe}`]);
        ws.mergeCells(ar.number, 1, ar.number, 6);
        ar.getCell(1).alignment = { wrapText: true };
      }
    }

    ws.getColumn(1).width = 12;
    for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 20;
    ws.getColumn(6).width = 18;

    const buf = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(buf), nome: `fluxo-caixa-${cal.periodo.de}_${cal.periodo.ate}` };
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
