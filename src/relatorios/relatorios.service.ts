import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { Area, perfilPodeAcessar } from '../common/rbac/acesso.config';
import { novoDocumento, tabela, totalDestaque, money, dataBR, Pdf } from '../documentos/pdf.renderer';
import { Workbook } from 'exceljs';

type Coluna = { titulo: string; largura: number; alinhamento?: 'left' | 'right' };
export interface Filtros {
  de?: string;
  ate?: string;
  status?: string;
}
interface Relatorio {
  area: Area;
  titulo: string;
  build: (empresaId: number, f: Filtros) => Promise<{ colunas: Coluna[]; linhas: string[][]; total?: { rotulo: string; valor: string } }>;
}

const n = (v: unknown) => Number(v ?? 0);

/** Fragmento de período (gte/lte) para o campo de data do tipo, se informado. */
function periodo(campo: string, f: Filtros): Record<string, unknown> {
  const w: Record<string, Date> = {};
  if (f.de) w.gte = new Date(f.de + 'T00:00:00');
  if (f.ate) w.lte = new Date(f.ate + 'T23:59:59');
  return Object.keys(w).length ? { [campo]: w } : {};
}
/** Igualdade de status no campo indicado, se informado. */
function statusEq(campo: string, f: Filtros): Record<string, unknown> {
  return f.status ? { [campo]: f.status } : {};
}

/**
 * Relatórios em PDF (papel timbrado) por área. Um botão "Relatório" em cada tela
 * baixa a listagem completa. RBAC é validado POR TIPO (mesmo mapa de áreas).
 */
@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados estruturados do relatório (reaproveitados por PDF e Excel). */
  private async dados(tipo: string, user: AuthUser, filtros: Filtros) {
    const rel = this.relatorios()[tipo];
    if (!rel) throw new NotFoundException('Relatório desconhecido.');
    if (!perfilPodeAcessar(user.acesso, rel.area)) {
      throw new ForbiddenException('Seu perfil não pode gerar este relatório.');
    }
    const { colunas, linhas, total } = await rel.build(user.empresaId, filtros);
    const descFiltro = [
      filtros.de || filtros.ate ? `Período: ${filtros.de ? dataBR(filtros.de) : '…'} a ${filtros.ate ? dataBR(filtros.ate) : '…'}` : '',
      filtros.status ? `Status: ${filtros.status}` : '',
    ].filter(Boolean).join('   ·   ');
    return { titulo: rel.titulo, colunas, linhas, total, descFiltro };
  }

  async gerar(tipo: string, user: AuthUser, filtros: Filtros = {}): Promise<{ doc: Pdf; nome: string }> {
    const d = await this.dados(tipo, user, filtros);
    const doc = novoDocumento(d.titulo, `${d.linhas.length} registro(s)`);
    if (d.descFiltro) {
      doc.moveDown(0.3).fillColor('#807d72').font('Helvetica').fontSize(9).text('Filtros aplicados — ' + d.descFiltro);
      doc.moveDown(0.2).fillColor('#242a26');
    }
    if (d.linhas.length) {
      tabela(doc, d.colunas, d.linhas);
      if (d.total) totalDestaque(doc, d.total.rotulo, d.total.valor);
    } else {
      doc.moveDown(1).fillColor('#807d72').font('Helvetica').fontSize(11).text('Nenhum registro para este relatório.');
    }
    return { doc, nome: `relatorio-${tipo}` };
  }

  /** Mesmo relatório em Excel (.xlsx), com os tons da marca no cabeçalho. */
  async xlsx(tipo: string, user: AuthUser, filtros: Filtros = {}): Promise<{ buffer: Buffer; nome: string }> {
    const d = await this.dados(tipo, user, filtros);
    const wb = new Workbook();
    wb.creator = 'Grupo Cherkesian · ERP';
    const ws = wb.addWorksheet('Relatório');
    const nCols = Math.max(1, d.colunas.length);

    ws.mergeCells(1, 1, 1, nCols);
    const tCell = ws.getCell(1, 1);
    tCell.value = d.titulo;
    tCell.font = { bold: true, size: 14, color: { argb: 'FF1E2C48' } };

    let headerRow = 3;
    if (d.descFiltro) {
      ws.mergeCells(2, 1, 2, nCols);
      const fCell = ws.getCell(2, 1);
      fCell.value = 'Filtros: ' + d.descFiltro;
      fCell.font = { size: 9, color: { argb: 'FF807D72' } };
      headerRow = 4;
    }

    const hr = ws.getRow(headerRow);
    d.colunas.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.titulo;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2C48' } };
      cell.alignment = { horizontal: c.alinhamento === 'right' ? 'right' : 'left' };
    });
    hr.commit();

    d.linhas.forEach((l) => {
      const r = ws.addRow(l);
      d.colunas.forEach((c, i) => { if (c.alinhamento === 'right') r.getCell(i + 1).alignment = { horizontal: 'right' }; });
    });
    if (d.total) {
      const tr = ws.addRow([]);
      tr.getCell(1).value = d.total.rotulo;
      tr.getCell(Math.max(1, nCols)).value = d.total.valor;
      tr.font = { bold: true };
    }

    d.colunas.forEach((c, i) => {
      const maxLen = Math.max(c.titulo.length, ...d.linhas.map((l) => String(l[i] ?? '').length), 8);
      ws.getColumn(i + 1).width = Math.min(52, maxLen + 3);
    });

    const buf = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(buf), nome: `relatorio-${tipo}` };
  }

  private relatorios(): Record<string, Relatorio> {
    return {
      pedidos: {
        area: 'vendas',
        titulo: 'Relatório de Pedidos',
        build: async (empresaId, f) => {
          const regs = await this.prisma.pedido.findMany({ where: { empresaId, ...periodo('data', f), ...statusEq('etapa', f) }, include: { cliente: { select: { nome: true } } }, orderBy: { id: 'desc' }, take: 500 });
          const total = regs.reduce((s, p) => s + n(p.valorTotal), 0);
          return {
            colunas: [
              { titulo: 'Número', largura: 60 },
              { titulo: 'Cliente', largura: 150 },
              { titulo: 'Valor', largura: 80, alinhamento: 'right' },
              { titulo: 'Status', largura: 90 },
              { titulo: 'Etapa', largura: 60 },
              { titulo: 'Data', largura: 55 },
            ],
            linhas: regs.map((p) => [p.numero, p.cliente?.nome ?? '—', money(p.valorTotal), p.status, p.etapa, dataBR(p.data)]),
            total: { rotulo: 'Total dos pedidos', valor: money(total) },
          };
        },
      },
      bonificacao: {
        area: 'vendas',
        titulo: 'Relatório de Bonificações',
        build: async (empresaId, f) => {
          const regs = await this.prisma.pedido.findMany({
            where: { empresaId, bonificacao: true, ...periodo('data', f) },
            include: { cliente: { select: { nome: true } }, itens: { select: { quantidade: true } } },
            orderBy: { data: 'desc' }, take: 1000,
          });
          const mesAno = (d: Date) => { const x = new Date(d); return `${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`; };
          const pecasDe = (p: { itens: { quantidade: number }[] }) => p.itens.reduce((a, i) => a + i.quantidade, 0);
          const total = regs.reduce((s, p) => s + n(p.valorTotal), 0);
          const pecas = regs.reduce((s, p) => s + pecasDe(p), 0);
          return {
            colunas: [
              { titulo: 'Número', largura: 55 },
              { titulo: 'Cliente', largura: 160 },
              { titulo: 'Mês', largura: 55 },
              { titulo: 'Peças', largura: 45, alinhamento: 'right' },
              { titulo: 'Valor bonificado', largura: 90, alinhamento: 'right' },
              { titulo: 'Etapa', largura: 60 },
              { titulo: 'Data', largura: 55 },
            ],
            linhas: regs.map((p) => [p.numero, p.cliente?.nome ?? '—', mesAno(p.data), String(pecasDe(p)), money(p.valorTotal), p.etapa, dataBR(p.data)]),
            total: { rotulo: `Total bonificado · ${regs.length} pedido(s) · ${pecas} peças`, valor: money(total) },
          };
        },
      },
      ops: {
        area: 'producao',
        titulo: 'Relatório de Ordens de Produção',
        build: async (_e, f) => {
          const regs = await this.prisma.oP.findMany({ where: { ...periodo('entregaPrev', f), ...statusEq('status', f) }, orderBy: { id: 'desc' }, take: 500 });
          return {
            colunas: [
              { titulo: 'Número', largura: 75 },
              { titulo: 'Qtd', largura: 50, alinhamento: 'right' },
              { titulo: 'Status', largura: 130 },
              { titulo: 'Progr.', largura: 55, alinhamento: 'right' },
              { titulo: 'Prioridade', largura: 80 },
              { titulo: 'Entrega', largura: 55 },
            ],
            linhas: regs.map((o) => [o.numero, String(o.quantidade), o.status, `${o.progresso}%`, o.prioridade, dataBR(o.entregaPrev)]),
          };
        },
      },
      nfs: {
        area: 'expedicao',
        titulo: 'Relatório de Notas Fiscais',
        build: async (empresaId, f) => {
          const regs = await this.prisma.notaFiscal.findMany({ where: { empresaId, ...periodo('emitidaEm', f), ...statusEq('status', f) }, orderBy: { id: 'desc' }, take: 500 });
          const filialIds = [...new Set(regs.map((r) => r.filialId).filter((x): x is number => x != null))];
          const pedidoIds = [...new Set(regs.map((r) => r.pedidoId).filter((x): x is number => x != null))];
          const [filiais, pedidos] = await Promise.all([
            this.prisma.filial.findMany({ where: { id: { in: filialIds } } }),
            this.prisma.pedido.findMany({ where: { id: { in: pedidoIds } }, include: { cliente: true } }),
          ]);
          const fMap = new Map(filiais.map((x) => [x.id, x]));
          const pMap = new Map(pedidos.map((x) => [x.id, x]));
          let totValor = 0, totProd = 0, totBc = 0, totIcms = 0, totPis = 0, totCofins = 0;
          const linhas = regs.map((nf) => {
            const fil = nf.filialId != null ? fMap.get(nf.filialId) : undefined;
            const ped = nf.pedidoId != null ? pMap.get(nf.pedidoId) : undefined;
            const cli = ped?.cliente;
            const val = n(nf.valor);
            const prod = nf.valorProdutos != null ? n(nf.valorProdutos) : val;
            const bc = n(nf.baseIcms), icms = n(nf.valorIcms), pis = n(nf.valorPis), cof = n(nf.valorCofins);
            totValor += val; totProd += prod; totBc += bc; totIcms += icms; totPis += pis; totCofins += cof;
            return [
              fil?.nome ?? '—', fil?.cnpj ?? '—', fil?.uf ?? '—',
              cli?.nome ?? '—', cli?.cnpjCpf ?? '—', cli?.uf ?? '—',
              nf.numero, nf.cfop ?? '—', nf.natureza ?? '—', dataBR(nf.emitidaEm),
              money(prod), money(bc), money(icms), money(pis), money(cof), money(val),
            ];
          });
          linhas.push([`TOTAIS · ${regs.length} nota(s)`, '', '', '', '', '', '', '', '', '', money(totProd), money(totBc), money(totIcms), money(totPis), money(totCofins), money(totValor)]);
          return {
            colunas: [
              { titulo: 'REMETENTE', largura: 108 }, { titulo: 'CNPJ', largura: 94 }, { titulo: 'UF', largura: 24 },
              { titulo: 'DESTINATÁRIO', largura: 120 }, { titulo: 'CNPJ/CPF', largura: 94 }, { titulo: 'UF', largura: 24 },
              { titulo: 'NF', largura: 50 }, { titulo: 'CFOP', largura: 50 }, { titulo: 'NATUREZA', largura: 104 }, { titulo: 'EMISSÃO', largura: 54 },
              { titulo: 'VLR PROD.', largura: 74, alinhamento: 'right' }, { titulo: 'BASE ICMS', largura: 74, alinhamento: 'right' }, { titulo: 'ICMS', largura: 68, alinhamento: 'right' }, { titulo: 'PIS', largura: 60, alinhamento: 'right' }, { titulo: 'COFINS', largura: 64, alinhamento: 'right' }, { titulo: 'VALOR NF', largura: 78, alinhamento: 'right' },
            ],
            linhas,
          };
        },
      },
      clientes: {
        area: 'clientes',
        titulo: 'Relatório de Clientes',
        build: async (empresaId, f) => {
          const regs = await this.prisma.cliente.findMany({ where: { empresaId, ...periodo('criadoEm', f) }, orderBy: { nome: 'asc' }, take: 500 });
          return {
            colunas: [
              { titulo: 'Nome', largura: 150 },
              { titulo: 'Cidade/UF', largura: 90 },
              { titulo: 'Segmento', largura: 90 },
              { titulo: 'CNPJ/CPF', largura: 95 },
              { titulo: 'Novo?', largura: 45 },
            ],
            linhas: regs.map((c) => [c.nome, c.cidadeUf ?? '—', c.segmento ?? '—', c.cnpjCpf ?? '—', c.clienteNovo ? 'sim' : 'não']),
          };
        },
      },
      produtos: {
        area: 'precificacao',
        titulo: 'Relatório de Produtos',
        build: async (empresaId) => {
          const regs = await this.prisma.produto.findMany({ where: { empresaId }, orderBy: { codigo: 'asc' }, take: 500 });
          return {
            colunas: [
              { titulo: 'Código', largura: 95 },
              { titulo: 'Descrição', largura: 165 },
              { titulo: 'Categoria', largura: 90 },
              { titulo: 'Cor', largura: 65 },
              { titulo: 'Preço', largura: 65, alinhamento: 'right' },
            ],
            linhas: regs.map((p) => [p.codigo, p.descricao, p.categoria, p.cor ?? '—', p.precoBase ? money(p.precoBase) : '—']),
          };
        },
      },
      materiais: {
        area: 'estoque',
        titulo: 'Relatório de Matéria-prima',
        build: async (empresaId) => {
          const regs = await this.prisma.material.findMany({ where: { empresaId }, orderBy: { codigo: 'asc' }, take: 500 });
          return {
            colunas: [
              { titulo: 'Código', largura: 95 },
              { titulo: 'Descrição', largura: 165 },
              { titulo: 'Saldo', largura: 70, alinhamento: 'right' },
              { titulo: 'Mínimo', largura: 70, alinhamento: 'right' },
              { titulo: 'Situação', largura: 75 },
            ],
            linhas: regs.map((m) => [m.codigo, m.descricao, `${n(m.saldo)} ${m.unidade}`, `${n(m.minimo)} ${m.unidade}`, n(m.saldo) < n(m.minimo) ? 'ABAIXO' : 'ok']),
          };
        },
      },
      compras: {
        area: 'compras',
        titulo: 'Relatório de Ordens de Compra',
        build: async (_e, f) => {
          const regs = await this.prisma.ordemCompra.findMany({ where: { ...periodo('previsao', f), ...statusEq('status', f) }, orderBy: { id: 'desc' }, take: 500, include: { fornecedor: { select: { nome: true } } } });
          const total = regs.reduce((s, o) => s + n(o.valor), 0);
          return {
            colunas: [
              { titulo: 'Número', largura: 65 },
              { titulo: 'Material', largura: 150 },
              { titulo: 'Qtd', largura: 55, alinhamento: 'right' },
              { titulo: 'Valor', largura: 75, alinhamento: 'right' },
              { titulo: 'Fornecedor', largura: 95 },
              { titulo: 'Status', largura: 55 },
            ],
            linhas: regs.map((o) => [o.numero, o.descricao, `${n(o.quantidade)} ${o.unidade}`, money(o.valor), o.fornecedor?.nome ?? '—', o.status]),
            total: { rotulo: 'Total em compras', valor: money(total) },
          };
        },
      },
      expedicoes: {
        area: 'expedicao',
        titulo: 'Relatório de Expedições',
        build: async (_e, f) => {
          const regs = await this.prisma.expedicao.findMany({ where: { ...periodo('data', f), ...statusEq('status', f) }, orderBy: { id: 'desc' }, take: 500 });
          return {
            colunas: [
              { titulo: 'Número', largura: 75 },
              { titulo: 'Status', largura: 85 },
              { titulo: 'NF', largura: 75 },
              { titulo: 'Transportadora', largura: 120 },
              { titulo: 'Peças', largura: 45, alinhamento: 'right' },
              { titulo: 'Data', largura: 55 },
            ],
            linhas: regs.map((e) => [e.numero, e.status, e.nf ?? '—', e.transportadora ?? '—', String(e.pecas), dataBR(e.data)]),
          };
        },
      },
      receber: {
        area: 'receber',
        titulo: 'Relatório de Contas a Receber',
        build: async (empresaId, f) => {
          const regs = await this.prisma.contaReceber.findMany({ where: { empresaId, ...periodo('vencimento', f), ...statusEq('status', f) }, orderBy: { vencimento: 'asc' }, take: 500 });
          const aberto = regs.filter((c) => c.status !== 'pago').reduce((s, c) => s + (n(c.valor) - n(c.pago)), 0);
          const totJuros = regs.reduce((s, c) => s + n(c.juros), 0);
          return {
            colunas: [
              { titulo: 'Vencimento', largura: 85 },
              { titulo: 'Valor', largura: 92, alinhamento: 'right' },
              { titulo: 'Pago', largura: 92, alinhamento: 'right' },
              { titulo: 'Juros', largura: 82, alinhamento: 'right' },
              { titulo: 'Saldo', largura: 92, alinhamento: 'right' },
              { titulo: 'Status', largura: 80 },
            ],
            linhas: regs.map((c) => [dataBR(c.vencimento), money(c.valor), money(c.pago), money(c.juros), money(n(c.valor) - n(c.pago)), c.status]),
            total: { rotulo: `Saldo a receber (aberto)${totJuros > 0 ? ` · Juros recebidos ${money(totJuros)}` : ''}`, valor: money(aberto) },
          };
        },
      },
      pagar: {
        area: 'pagar',
        titulo: 'Relatório de Contas a Pagar',
        build: async (empresaId, f) => {
          const regs = await this.prisma.contaPagar.findMany({ where: { empresaId, ...periodo('vencimento', f), ...statusEq('status', f) }, orderBy: { vencimento: 'asc' }, take: 500 });
          const aberto = regs.filter((c) => c.status !== 'pago').reduce((s, c) => s + (n(c.valor) - n(c.pago)), 0);
          const totJuros = regs.reduce((s, c) => s + n(c.juros), 0);
          return {
            colunas: [
              { titulo: 'Categoria', largura: 100 },
              { titulo: 'Vencimento', largura: 72 },
              { titulo: 'Valor', largura: 80, alinhamento: 'right' },
              { titulo: 'Pago', largura: 76, alinhamento: 'right' },
              { titulo: 'Juros', largura: 72, alinhamento: 'right' },
              { titulo: 'Saldo', largura: 80, alinhamento: 'right' },
              { titulo: 'Status', largura: 55 },
            ],
            linhas: regs.map((c) => [c.categoria, dataBR(c.vencimento), money(c.valor), money(c.pago), money(c.juros), money(n(c.valor) - n(c.pago)), c.status]),
            total: { rotulo: `Saldo a pagar (aberto)${totJuros > 0 ? ` · Juros pagos ${money(totJuros)}` : ''}`, valor: money(aberto) },
          };
        },
      },
      comissoes: {
        area: 'comissoes',
        titulo: 'Relatório de Comissões',
        build: async (empresaId, f) => {
          const regs = await this.prisma.comissao.findMany({ where: { empresaId, ...statusEq('statusPgto', f) }, orderBy: { id: 'desc' }, take: 500 });
          const total = regs.filter((c) => c.statusPgto !== 'Pago').reduce((s, c) => s + n(c.comissao), 0);
          return {
            colunas: [
              { titulo: 'Vendedor', largura: 150 },
              { titulo: 'Valor Venda', largura: 110, alinhamento: 'right' },
              { titulo: 'Comissão', largura: 110, alinhamento: 'right' },
              { titulo: 'Status', largura: 100 },
            ],
            linhas: regs.map((c) => [c.vendedor, money(c.valorVenda), money(c.comissao), c.statusPgto]),
            total: { rotulo: 'Comissões a pagar', valor: money(total) },
          };
        },
      },
    };
  }
}
