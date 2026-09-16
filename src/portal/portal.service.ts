import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Produto } from '@prisma/client';
import { NfeService } from '../nfe/nfe.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { AuthUser } from '../auth/auth.types';

/**
 * Portal do Cliente — visão EXTERNA e somente-leitura para o próprio cliente.
 * Mostra só o que é DELE: estoque pronta-entrega e o andamento/prazo dos pedidos.
 * Nada de custo, margem, outros clientes ou telas internas.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nfe: NfeService,
  ) {}

  /**
   * Resolve o clienteId do escopo. Para o perfil `cliente` vem travado no token
   * (ignora qualquer parâmetro). Para admin (`total`) permite pré-visualizar um
   * cliente específico via ?clienteId= (útil para conferir o portal do cliente).
   */
  private async escopo(user: AuthUser, override?: number): Promise<number> {
    if (user.acesso === 'cliente') {
      if (!user.clienteId) {
        throw new ForbiddenException('Login de cliente sem vínculo. Contate o fornecedor.');
      }
      return user.clienteId;
    }
    if (user.acesso === 'total') {
      if (!override) {
        throw new BadRequestException('Informe ?clienteId= para pré-visualizar o portal.');
      }
      return override;
    }
    throw new ForbiddenException('Área exclusiva do portal do cliente.');
  }

  private async clienteDoEscopo(user: AuthUser, override?: number) {
    const clienteId = await this.escopo(user, override);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId: user.empresaId },
      select: { id: true, nome: true, fantasia: true, grupo: true },
    });
    if (!cliente) {
      throw new ForbiddenException('Cliente do portal não encontrado.');
    }
    return cliente;
  }

  /**
   * Produtos "donos" do cliente: casam por clienteId direto OU pelo grupo do
   * cliente (clienteGrupo). É o mesmo critério do catálogo interno do cliente.
   */
  private async produtosDoCliente(
    empresaId: number,
    cliente: { id: number; grupo: string | null },
  ) {
    const ors: Array<Record<string, unknown>> = [{ clienteId: cliente.id }];
    if (cliente.grupo && cliente.grupo.trim()) {
      ors.push({ clienteGrupo: cliente.grupo.trim() });
    }
    return this.prisma.produto.findMany({
      where: { empresaId, OR: ors },
      select: {
        id: true,
        codigo: true,
        descricao: true,
        cor: true,
        setor: true,
        grade: true,
        estoque: { select: { tamanho: true, entradas: true, saidas: true } },
      },
      orderBy: { descricao: 'asc' },
    });
  }

  /** Estoque pronta-entrega do cliente: saldo (entradas−saídas) por produto/tamanho. */
  async estoque(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const produtos = await this.produtosDoCliente(user.empresaId, cliente);

    const rankTam = PortalService.rankTam;

    const itens = produtos
      .map((p) => {
        const tamanhos = (p.estoque || [])
          .map((e) => ({ tamanho: e.tamanho, saldo: (e.entradas || 0) - (e.saidas || 0) }))
          .filter((t) => t.saldo > 0)
          .sort((a, b) => rankTam(a.tamanho) - rankTam(b.tamanho) || a.tamanho.localeCompare(b.tamanho));
        const total = tamanhos.reduce((s, t) => s + t.saldo, 0);
        return {
          produtoId: p.id,
          codigo: p.codigo,
          descricao: p.descricao,
          cor: p.cor,
          setor: p.setor,
          tamanhos,
          total,
        };
      })
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);

    const totalPecas = itens.reduce((s, p) => s + p.total, 0);
    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      totalItens: itens.length,
      totalPecas,
      itens,
    };
  }

  /** Andamento e prazos dos pedidos do cliente (fora orçamentos e cancelados). */
  async producao(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);

    const pedidos = await this.prisma.pedido.findMany({
      where: {
        clienteId: cliente.id,
        empresaId: user.empresaId,
        etapa: { notIn: ['orcamento', 'cancelado'] },
      },
      select: {
        id: true,
        numero: true,
        data: true,
        prazoEntrega: true,
        etapa: true,
        ordemCompraCliente: true,
        itens: { select: { descricao: true, cor: true, quantidade: true, quantidadeExpedida: true } },
        ops: { select: { status: true, progresso: true, entregaPrev: true, quantidade: true } },
      },
      orderBy: { data: 'desc' },
    });

    const ETAPA: Record<string, { label: string; passo: number }> = {
      aprovado: { label: 'Pedido aprovado', passo: 1 },
      piloto: { label: 'Aprovação da peça-piloto', passo: 2 },
      material: { label: 'Separação de material', passo: 3 },
      compra: { label: 'Compra de insumos', passo: 3 },
      producao: { label: 'Em produção', passo: 4 },
      estoque: { label: 'Pronto — em estoque', passo: 5 },
      expedicao: { label: 'Em expedição', passo: 6 },
      parcial: { label: 'Entregue parcial', passo: 6 },
      concluido: { label: 'Entregue', passo: 7 },
    };
    const TOTAL_PASSOS = 7;
    const hoje = new Date();

    const lista = pedidos.map((p) => {
      const meta = ETAPA[p.etapa] || { label: p.etapa, passo: 1 };
      // Progresso: média das OPs quando há produção; senão pelo passo da etapa.
      let progresso = Math.round((meta.passo / TOTAL_PASSOS) * 100);
      if (p.ops.length && meta.passo >= 4 && meta.passo < 7) {
        const media = p.ops.reduce((s, o) => s + (o.progresso || 0), 0) / p.ops.length;
        progresso = Math.max(progresso, Math.round(media));
      }
      if (p.etapa === 'concluido') progresso = 100;

      const totalPecas = p.itens.reduce((s, i) => s + (i.quantidade || 0), 0);
      const expedidas = p.itens.reduce((s, i) => s + (i.quantidadeExpedida || 0), 0);
      const prazo = p.prazoEntrega || p.ops.map((o) => o.entregaPrev).filter(Boolean).sort()[0] || null;
      const atrasado = !!prazo && p.etapa !== 'concluido' && new Date(prazo) < hoje;

      return {
        pedidoId: p.id,
        numero: p.numero,
        data: p.data,
        ordemCompraCliente: p.ordemCompraCliente,
        etapa: p.etapa,
        etapaLabel: meta.label,
        progresso,
        prazoEntrega: prazo,
        atrasado,
        totalPecas,
        expedidas,
        itens: p.itens.map((i) => ({
          descricao: i.descricao,
          cor: i.cor,
          quantidade: i.quantidade,
          expedida: i.quantidadeExpedida,
        })),
      };
    });

    const emAndamento = lista.filter((p) => p.etapa !== 'concluido').length;
    const atrasados = lista.filter((p) => p.atrasado).length;
    const proximaEntrega =
      lista
        .filter((p) => p.prazoEntrega && p.etapa !== 'concluido')
        .map((p) => p.prazoEntrega as Date)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;

    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      resumo: { total: lista.length, emAndamento, atrasados, proximaEntrega },
      pedidos: lista,
    };
  }

  /** KPIs do topo do portal (estoque + produção num só request). */
  async resumo(user: AuthUser, override?: number) {
    const [est, prod] = await Promise.all([
      this.estoque(user, override),
      this.producao(user, override),
    ]);
    return {
      cliente: est.cliente,
      estoque: { itens: est.totalItens, pecas: est.totalPecas },
      producao: prod.resumo,
    };
  }

  /** Notas fiscais de VENDA (faturamento) emitidas para o cliente — PDF/XML quando reais (Focus). */
  async notas(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const pedidos = await this.prisma.pedido.findMany({
      where: { clienteId: cliente.id, empresaId: user.empresaId },
      select: { id: true, numero: true },
    });
    const numById = new Map(pedidos.map((p) => [p.id, p.numero]));
    const pedidoIds = pedidos.map((p) => p.id);

    const notas = pedidoIds.length
      ? await this.prisma.notaFiscal.findMany({
          where: {
            empresaId: user.empresaId,
            tipo: 'venda',
            status: { in: ['autorizada', 'cancelada'] },
            pedidoId: { in: pedidoIds },
          },
          select: {
            id: true, numero: true, serie: true, chave: true, valor: true,
            emitidaEm: true, status: true, provedor: true, pedidoId: true,
            ordemCompraCliente: true,
          },
          orderBy: { emitidaEm: 'desc' },
        })
      : [];

    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      notas: notas.map((n) => ({
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        chave: n.chave,
        valor: n.valor,
        emitidaEm: n.emitidaEm,
        status: n.status,
        pedido: n.pedidoId ? numById.get(n.pedidoId) ?? null : null,
        ordemCompraCliente: n.ordemCompraCliente,
        // PDF/XML só existem para nota REAL (Focus) e autorizada.
        arquivos: n.provedor === 'focusnfe' && n.status === 'autorizada',
      })),
    };
  }

  /**
   * Baixa DANFE/XML de UMA nota do cliente. TRAVA de escopo: a nota tem que ser de VENDA
   * e pertencer a um pedido do próprio cliente (impede baixar a NF de outro cliente pelo id).
   */
  async baixarNota(user: AuthUser, notaId: number, tipo: 'danfe' | 'xml', override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const nota = await this.prisma.notaFiscal.findFirst({
      where: { id: notaId, empresaId: user.empresaId, tipo: 'venda' },
      select: { id: true, pedidoId: true },
    });
    if (!nota || !nota.pedidoId) throw new ForbiddenException('Nota não encontrada.');
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: nota.pedidoId, clienteId: cliente.id, empresaId: user.empresaId },
      select: { id: true },
    });
    if (!pedido) throw new ForbiddenException('Esta nota não pertence ao seu cadastro.');
    return this.nfe.baixarArquivo(notaId, user.empresaId, tipo);
  }

  private static readonly ORDEM_TAM = ['PP', 'P', 'M', 'G', 'G1', 'G2', 'G3', 'G4', 'G5', 'GG', 'XG', 'EXG', 'U'];
  /** Ordem visual dos tamanhos (PP…G8, depois o resto em ordem alfabética). */
  static rankTam(t: string): number {
    const i = PortalService.ORDEM_TAM.indexOf(String(t || '').toUpperCase());
    return i < 0 ? 999 : i;
  }

  /**
   * Catálogo "Disponível para compra": produtos do cliente (mesmo critério do estoque) +
   * produtos dos contratos ativos dele. O PREÇO é resolvido AQUI, no servidor: preço do
   * contrato quando existir; senão o preço de venda do próprio ERP (precoBase/precoEspecial,
   * o mesmo que vai nos pedidos e na NF). Nunca uma tabela genérica do front — evita
   * divergência entre o portal e a nota fiscal. Disponibilidade = saldo por tamanho
   * (inclui tamanhos com saldo zero, que podem ser encomendados); prazo = pronta entrega
   * quando há saldo, senão o prazo de produção do contrato.
   */
  async catalogo(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const empresaId = user.empresaId;

    const contratos = await this.prisma.contrato.findMany({
      where: {
        empresaId, clienteId: cliente.id, ativo: true,
        OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }],
      },
      include: { itens: { select: { produtoId: true, preco: true, unidade: true } } },
      orderBy: { id: 'desc' },
    });
    // Primeiro contrato (mais recente) que tabela o produto vence.
    const precoContrato = new Map<number, { preco: Prisma.Decimal; unidade: string | null }>();
    for (const c of contratos) {
      for (const it of c.itens) {
        if (it.produtoId != null && !precoContrato.has(it.produtoId)) {
          precoContrato.set(it.produtoId, { preco: it.preco, unidade: it.unidade });
        }
      }
    }
    const contratoRef = contratos[0] ?? null;
    const prazoContrato = (() => {
      const p = (contratoRef?.prazoEntrega || '').trim();
      if (!p) return null;
      return /^\d+$/.test(p) ? `${p} dias` : p; // "30" -> "30 dias"; "10 dias úteis" fica como está
    })();

    const ors: Array<Record<string, unknown>> = [{ clienteId: cliente.id }];
    if (cliente.grupo && cliente.grupo.trim()) ors.push({ clienteGrupo: cliente.grupo.trim() });
    const idsContrato = [...precoContrato.keys()];
    if (idsContrato.length) ors.push({ id: { in: idsContrato } });

    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, OR: ors },
      select: {
        id: true, codigo: true, descricao: true, cor: true, setor: true,
        precoBase: true, precoEspecial: true, tamsEspeciais: true,
        estoque: { select: { tamanho: true, entradas: true, saidas: true } },
      },
      orderBy: { descricao: 'asc' },
    });

    const itens = produtos
      .map((p) => {
        const tamanhos = (p.estoque || [])
          .map((e) => ({ tamanho: e.tamanho, saldo: Math.max(0, (e.entradas || 0) - (e.saidas || 0)) }))
          .sort((a, b) => PortalService.rankTam(a.tamanho) - PortalService.rankTam(b.tamanho) || a.tamanho.localeCompare(b.tamanho));
        const disponivel = tamanhos.reduce((s, t) => s + t.saldo, 0);
        const ctr = precoContrato.get(p.id);
        // Preço de contrato é único p/ o item; sem contrato, vale a faixa especial dos tamanhos grandes.
        const tamsEsp = ctr ? [] : PedidosService.tamsEspeciais(p as unknown as Produto);
        return {
          produtoId: p.id,
          sku: p.codigo,
          descricao: p.descricao,
          cor: p.cor,
          setor: p.setor,
          unidade: ctr?.unidade || 'un',
          preco: ctr ? ctr.preco : p.precoBase,
          precoEspecial: !ctr && p.precoEspecial != null && tamsEsp.length ? p.precoEspecial : null,
          tamsEspeciais: tamsEsp,
          precoOrigem: ctr ? 'contrato' : p.precoBase != null ? 'tabela' : null,
          tamanhos,
          disponivel,
          prazo: disponivel > 0 ? 'Pronta entrega' : prazoContrato || 'Sob encomenda',
        };
      })
      .sort((a, b) => b.disponivel - a.disponivel || a.descricao.localeCompare(b.descricao));

    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      contrato: contratoRef
        ? {
            numero: contratoRef.numero,
            prazoEntrega: prazoContrato,
            condicaoPagamento: contratoRef.condicaoPagamento,
            formaPagamento: contratoRef.formaPagamento,
          }
        : null,
      totalItens: itens.length,
      itens,
    };
  }
}
