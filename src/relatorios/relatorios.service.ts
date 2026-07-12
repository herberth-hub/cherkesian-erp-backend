import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { Area, perfilPodeAcessar } from '../common/rbac/acesso.config';
import { novoDocumento, tabela, totalDestaque, money, dataBR, Pdf } from '../documentos/pdf.renderer';

type Coluna = { titulo: string; largura: number; alinhamento?: 'left' | 'right' };
interface Relatorio {
  area: Area;
  titulo: string;
  build: (empresaId: number) => Promise<{ colunas: Coluna[]; linhas: string[][]; total?: { rotulo: string; valor: string } }>;
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Relatórios em PDF (papel timbrado) por área. Um botão "Relatório" em cada tela
 * baixa a listagem completa. RBAC é validado POR TIPO (mesmo mapa de áreas).
 */
@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  async gerar(tipo: string, user: AuthUser): Promise<{ doc: Pdf; nome: string }> {
    const rel = this.relatorios()[tipo];
    if (!rel) throw new NotFoundException('Relatório desconhecido.');
    if (!perfilPodeAcessar(user.acesso, rel.area)) {
      throw new ForbiddenException('Seu perfil não pode gerar este relatório.');
    }
    const { colunas, linhas, total } = await rel.build(user.empresaId);

    const doc = novoDocumento(rel.titulo, `${linhas.length} registro(s)`);
    if (linhas.length) {
      tabela(doc, colunas, linhas);
      if (total) totalDestaque(doc, total.rotulo, total.valor);
    } else {
      doc.moveDown(1).fillColor('#807d72').font('Helvetica').fontSize(11).text('Nenhum registro para este relatório.');
    }
    return { doc, nome: `relatorio-${tipo}` };
  }

  private relatorios(): Record<string, Relatorio> {
    return {
      pedidos: {
        area: 'vendas',
        titulo: 'Relatório de Pedidos',
        build: async (empresaId) => {
          const regs = await this.prisma.pedido.findMany({ where: { empresaId }, include: { cliente: { select: { nome: true } } }, orderBy: { id: 'desc' }, take: 500 });
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
      ops: {
        area: 'producao',
        titulo: 'Relatório de Ordens de Produção',
        build: async () => {
          const regs = await this.prisma.oP.findMany({ orderBy: { id: 'desc' }, take: 500 });
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
        build: async (empresaId) => {
          const regs = await this.prisma.notaFiscal.findMany({ where: { empresaId }, orderBy: { id: 'desc' }, take: 500 });
          const total = regs.reduce((s, nf) => s + n(nf.valor), 0);
          return {
            colunas: [
              { titulo: 'Número', largura: 90 },
              { titulo: 'Série', largura: 45 },
              { titulo: 'Status', largura: 90 },
              { titulo: 'Valor', largura: 85, alinhamento: 'right' },
              { titulo: 'Provedor', largura: 75 },
              { titulo: 'Data', largura: 55 },
            ],
            linhas: regs.map((nf) => [nf.numero, nf.serie, nf.status, money(nf.valor), nf.provedor, dataBR(nf.emitidaEm)]),
            total: { rotulo: 'Total emitido', valor: money(total) },
          };
        },
      },
      clientes: {
        area: 'clientes',
        titulo: 'Relatório de Clientes',
        build: async (empresaId) => {
          const regs = await this.prisma.cliente.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, take: 500 });
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
        build: async () => {
          const regs = await this.prisma.ordemCompra.findMany({ orderBy: { id: 'desc' }, take: 500, include: { fornecedor: { select: { nome: true } } } });
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
        build: async () => {
          const regs = await this.prisma.expedicao.findMany({ orderBy: { id: 'desc' }, take: 500 });
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
        build: async (empresaId) => {
          const regs = await this.prisma.contaReceber.findMany({ where: { empresaId }, orderBy: { vencimento: 'asc' }, take: 500 });
          const aberto = regs.filter((c) => c.status !== 'pago').reduce((s, c) => s + (n(c.valor) - n(c.pago)), 0);
          return {
            colunas: [
              { titulo: 'Vencimento', largura: 90 },
              { titulo: 'Valor', largura: 100, alinhamento: 'right' },
              { titulo: 'Pago', largura: 100, alinhamento: 'right' },
              { titulo: 'Saldo', largura: 100, alinhamento: 'right' },
              { titulo: 'Status', largura: 85 },
            ],
            linhas: regs.map((c) => [dataBR(c.vencimento), money(c.valor), money(c.pago), money(n(c.valor) - n(c.pago)), c.status]),
            total: { rotulo: 'Saldo a receber (aberto)', valor: money(aberto) },
          };
        },
      },
      pagar: {
        area: 'pagar',
        titulo: 'Relatório de Contas a Pagar',
        build: async (empresaId) => {
          const regs = await this.prisma.contaPagar.findMany({ where: { empresaId }, orderBy: { vencimento: 'asc' }, take: 500 });
          const aberto = regs.filter((c) => c.status !== 'pago').reduce((s, c) => s + (n(c.valor) - n(c.pago)), 0);
          return {
            colunas: [
              { titulo: 'Categoria', largura: 105 },
              { titulo: 'Vencimento', largura: 75 },
              { titulo: 'Valor', largura: 85, alinhamento: 'right' },
              { titulo: 'Pago', largura: 80, alinhamento: 'right' },
              { titulo: 'Saldo', largura: 85, alinhamento: 'right' },
              { titulo: 'Status', largura: 55 },
            ],
            linhas: regs.map((c) => [c.categoria, dataBR(c.vencimento), money(c.valor), money(c.pago), money(n(c.valor) - n(c.pago)), c.status]),
            total: { rotulo: 'Saldo a pagar (aberto)', valor: money(aberto) },
          };
        },
      },
      comissoes: {
        area: 'comissoes',
        titulo: 'Relatório de Comissões',
        build: async (empresaId) => {
          const regs = await this.prisma.comissao.findMany({ where: { empresaId }, orderBy: { id: 'desc' }, take: 500 });
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
