import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { CreditoService } from '../credito/credito.service';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class PedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credito: CreditoService,
  ) {}

  findAll(empresaId: number) {
    return this.prisma.pedido.findMany({
      where: { empresaId },
      include: {
        itens: true,
        cliente: { select: { id: true, nome: true } },
        filial: { select: { id: true, nome: true, matriz: true } },
      },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        itens: true,
        cliente: { select: { id: true, nome: true } },
        pilotos: true,
        ops: true,
      },
    });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${id} não encontrado.`);
    }
    return pedido;
  }

  /** Cria orçamento/pedido. Cliente novo ⇒ exigePiloto (trava a produção depois). */
  async create(dto: CreatePedidoDto, empresaId: number, criadoPor: string) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }

    // Crédito: consulta na criação do pedido; restrição bloqueia (admin libera).
    const credito = await this.credito.avaliarParaPedido(dto.clienteId, empresaId, criadoPor);
    if (!credito.permitido) throw new ConflictException(credito.motivo);

    // Resolve itens (valida produto, herda descrição) e soma o total.
    let valorTotal = new Prisma.Decimal(0);
    const itensData: Prisma.PedidoItemCreateWithoutPedidoInput[] = [];
    for (const item of dto.itens) {
      let descricao = item.descricao;
      if (item.produtoId) {
        const produto = await this.prisma.produto.findUnique({ where: { id: item.produtoId } });
        if (!produto || produto.empresaId !== empresaId) {
          throw new NotFoundException(`Produto ${item.produtoId} não encontrado.`);
        }
        descricao = descricao ?? produto.descricao;
      }
      if (!descricao) {
        throw new BadRequestException('Cada item precisa de descrição ou de um produtoId válido.');
      }
      const valorUnit = new Prisma.Decimal(item.valorUnit);
      valorTotal = valorTotal.plus(valorUnit.mul(item.quantidade));
      itensData.push({
        produtoId: item.produtoId,
        descricao,
        quantidade: item.quantidade,
        valorUnit,
      });
    }

    const numero = await this.gerarNumeroPedido(empresaId);
    const filialId = await this.resolverFilial(empresaId, dto.filialId);

    const pedido = await this.prisma.pedido.create({
      data: {
        empresaId,
        numero,
        clienteId: dto.clienteId,
        filialId,
        valorTotal,
        status: 'Orçamento',
        etapa: 'orcamento',
        clienteNovo: cliente.clienteNovo,
        prazoEntrega: dto.prazoEntrega ? new Date(dto.prazoEntrega) : undefined,
        formaPagamento: dto.formaPagamento,
        obs: dto.obs,
        criadoPor,
        itens: { create: itensData },
      },
      include: { itens: true },
    });

    return { ...pedido, exigePiloto: pedido.clienteNovo };
  }

  /** Aprova o orçamento: vira pedido e avança a etapa (piloto se cliente novo). */
  async aprovar(id: number, empresaId: number) {
    const pedido = await this.findOne(id, empresaId);
    if (pedido.etapa !== 'orcamento') {
      throw new ConflictException(
        `Pedido ${pedido.numero} já foi aprovado (etapa atual: ${pedido.etapa}).`,
      );
    }
    const proximaEtapa = pedido.clienteNovo ? 'piloto' : 'aprovado';
    return this.prisma.pedido.update({
      where: { id },
      data: { etapa: proximaEtapa, status: 'Aprovado' },
      include: { itens: true },
    });
  }

  /**
   * CORAÇÃO DO ERP — Gera a Ordem de Produção para um pedido:
   *  1. cliente novo exige peça-piloto liberada (senão bloqueia);
   *  2. calcula o consumo (BOM × quantidade) de cada material;
   *  3. compara com Material.saldo; se faltar, cria OrdemCompra (aguardando) e bloqueia;
   *  4. com material disponível, gera a OP, baixa o saldo e avança o pedido p/ produção.
   * Tudo numa transação.
   */
  async gerarOp(id: number, empresaId: number) {
    const pedido = await this.findOne(id, empresaId);

    // Pré-condições de estado
    if (pedido.etapa === 'orcamento') {
      throw new BadRequestException('Aprove o pedido antes de gerar a OP.');
    }
    if (['producao', 'estoque', 'expedicao'].includes(pedido.etapa) || pedido.ops.length > 0) {
      throw new ConflictException(`Pedido ${pedido.numero} já teve OP gerada.`);
    }

    // 1) Piloto liberado (para cliente novo)
    if (pedido.clienteNovo) {
      const pilotoLiberado = pedido.pilotos.some((p) => p.liberado);
      if (!pilotoLiberado) {
        return {
          status: 'bloqueado_piloto' as const,
          pedido: { numero: pedido.numero, etapa: pedido.etapa },
          message:
            'Cliente novo: é necessária uma peça-piloto aprovada antes de gerar a OP.',
        };
      }
    }

    // 2) Consumo agregado (BOM × quantidade) por material
    const necessarioPorMaterial = new Map<number, Prisma.Decimal>();
    let totalPecas = 0;
    for (const item of pedido.itens) {
      totalPecas += item.quantidade;
      if (!item.produtoId) continue;
      const bom = await this.prisma.consumo.findMany({ where: { produtoId: item.produtoId } });
      for (const b of bom) {
        const usa = b.quantidade.mul(item.quantidade);
        const atual = necessarioPorMaterial.get(b.materialId) ?? new Prisma.Decimal(0);
        necessarioPorMaterial.set(b.materialId, atual.plus(usa));
      }
    }

    // 3) Compara com o saldo dos materiais
    const materiais = await this.prisma.material.findMany({
      where: { id: { in: [...necessarioPorMaterial.keys()] } },
    });
    const faltantes: {
      material: (typeof materiais)[number];
      necessario: Prisma.Decimal;
      faltam: Prisma.Decimal;
    }[] = [];
    for (const material of materiais) {
      const necessario = necessarioPorMaterial.get(material.id)!;
      if (material.saldo.lessThan(necessario)) {
        faltantes.push({ material, necessario, faltam: necessario.minus(material.saldo) });
      }
    }

    // 3b) Faltou material → cria Ordem(ns) de Compra e bloqueia
    if (faltantes.length > 0) {
      const ordensCompra = await this.prisma.$transaction(async (tx) => {
        const fornecedor = await this.fornecedorPlaceholder(tx, empresaId);
        const criadas = [];
        for (const f of faltantes) {
          const numero = await this.gerarNumeroOC(tx);
          const oc = await tx.ordemCompra.create({
            data: {
              numero,
              fornecedorId: fornecedor.id,
              materialId: f.material.id,
              descricao: f.material.descricao,
              quantidade: f.faltam,
              unidade: f.material.unidade,
              valor: f.faltam.mul(f.material.custo),
              status: 'aguardando',
              motivo: `Reposição automática p/ pedido ${pedido.numero}`,
            },
          });
          criadas.push(oc);
        }
        await tx.pedido.update({
          where: { id },
          data: { etapa: 'compra', status: 'Aguardando material' },
        });
        return criadas;
      });

      return {
        status: 'bloqueado_material' as const,
        pedido: { numero: pedido.numero, etapa: 'compra' },
        faltantes: faltantes.map((f) => ({
          materialCodigo: f.material.codigo,
          descricao: f.material.descricao,
          necessario: f.necessario.toFixed(3),
          saldo: f.material.saldo.toFixed(3),
          faltam: f.faltam.toFixed(3),
          unidade: f.material.unidade,
        })),
        ordensCompra: ordensCompra.map((o) => ({
          numero: o.numero,
          material: o.descricao,
          quantidade: o.quantidade.toFixed(3),
          valor: o.valor.toFixed(2),
          status: o.status,
        })),
      };
    }

    // 4) Material disponível → gera OP, baixa saldo e avança o pedido
    const resultado = await this.prisma.$transaction(async (tx) => {
      for (const [materialId, necessario] of necessarioPorMaterial) {
        await tx.material.update({
          where: { id: materialId },
          data: { saldo: { decrement: necessario } },
        });
      }
      const numeroOp = await this.gerarNumeroOP(tx);
      const produtoId = pedido.itens.find((i) => i.produtoId)?.produtoId ?? null;
      const op = await tx.oP.create({
        data: {
          numero: numeroOp,
          pedidoId: pedido.id,
          filialId: pedido.filialId,
          produtoId,
          quantidade: totalPecas,
          status: 'a_iniciar',
          pilotoLiberado: true,
          progresso: 0,
        },
      });
      await tx.pedido.update({
        where: { id },
        data: { etapa: 'producao', status: 'Em produção' },
      });
      return op;
    });

    return {
      status: 'op_gerada' as const,
      pedido: { numero: pedido.numero, etapa: 'producao' },
      op: { numero: resultado.numero, status: resultado.status, quantidade: resultado.quantidade },
      consumo: [...necessarioPorMaterial.entries()].map(([materialId, q]) => {
        const m = materiais.find((x) => x.id === materialId)!;
        return { material: m.codigo, descricao: m.descricao, baixado: q.toFixed(3), unidade: m.unidade };
      }),
    };
  }

  // ===== Helpers =====

  /** Resolve a filial emissora: a informada (validada) ou a matriz da empresa. */
  private async resolverFilial(empresaId: number, filialId?: number): Promise<number | null> {
    if (filialId) {
      const f = await this.prisma.filial.findUnique({ where: { id: filialId } });
      if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Filial ${filialId} não encontrada.`);
      if (!f.ativa) throw new BadRequestException('Filial inativa — escolha uma filial ativa.');
      return f.id;
    }
    const matriz = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    return matriz?.id ?? null;
  }

  private async gerarNumeroPedido(empresaId: number): Promise<string> {
    const existentes = await this.prisma.pedido.findMany({
      where: { empresaId },
      select: { numero: true },
    });
    return proximoSequencial('PV', existentes.map((p) => p.numero), { pad: 2 });
  }

  private async gerarNumeroOP(tx: Prisma.TransactionClient): Promise<string> {
    const existentes = await tx.oP.findMany({ select: { numero: true } });
    return proximoSequencial('OP', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }

  private async gerarNumeroOC(tx: Prisma.TransactionClient): Promise<string> {
    const existentes = await tx.ordemCompra.findMany({ select: { numero: true } });
    return proximoSequencial('OC', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }

  /** Fornecedor "A DEFINIR" para OCs automáticas (compras ajusta depois). */
  private async fornecedorPlaceholder(tx: Prisma.TransactionClient, empresaId: number) {
    const existente = await tx.fornecedor.findFirst({
      where: { empresaId, nome: 'A DEFINIR' },
    });
    if (existente) return existente;
    return tx.fornecedor.create({
      data: { empresaId, nome: 'A DEFINIR', tipo: 'Reposição automática' },
    });
  }
}
