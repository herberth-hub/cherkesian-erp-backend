import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

/**
 * Portal do Cliente — visão EXTERNA e somente-leitura para o próprio cliente.
 * Mostra só o que é DELE: estoque pronta-entrega e o andamento/prazo dos pedidos.
 * Nada de custo, margem, outros clientes ou telas internas.
 */
@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

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

    const ordemTam = ['PP', 'P', 'M', 'G', 'G1', 'G2', 'G3', 'G4', 'G5', 'GG', 'XG', 'EXG', 'U'];
    const rankTam = (t: string) => {
      const i = ordemTam.indexOf(String(t || '').toUpperCase());
      return i < 0 ? 999 : i;
    };

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
}
