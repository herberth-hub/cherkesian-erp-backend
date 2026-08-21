import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Material, OrdemCompra, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrdemCompraDto } from './dto/create-ordem-compra.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number) {
    const ocs = await this.prisma.ordemCompra.findMany({
      where: { fornecedor: { empresaId } },
      orderBy: { id: 'desc' },
      include: {
        fornecedor: { select: { nome: true } },
        notaEntrada: { select: { numero: true } },
      },
    });
    // Sinaliza quando a baixa veio de uma NF de entrada (necessidade × compra).
    return ocs.map((o) => ({ ...o, recebidaViaNf: o.notaEntrada?.numero ?? null }));
  }

  async findOne(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.prisma.ordemCompra.findUnique({
      where: { id },
      include: { fornecedor: { select: { empresaId: true, nome: true } } },
    });
    if (!oc || oc.fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Ordem de compra ${id} não encontrada.`);
    }
    return oc;
  }

  async create(dto: CreateOrdemCompraDto, empresaId: number): Promise<OrdemCompra> {
    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
    if (!fornecedor || fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Fornecedor ${dto.fornecedorId} não encontrado.`);
    }
    if (dto.materialId) {
      const material = await this.prisma.material.findUnique({ where: { id: dto.materialId } });
      if (!material || material.empresaId !== empresaId) {
        throw new NotFoundException(`Material ${dto.materialId} não encontrado.`);
      }
    }

    const numero = await this.gerarNumero();
    return this.prisma.ordemCompra.create({
      data: {
        numero,
        fornecedorId: dto.fornecedorId,
        materialId: dto.materialId,
        descricao: dto.descricao,
        quantidade: dto.quantidade,
        unidade: dto.unidade,
        valor: dto.valor,
        status: 'aguardando',
        previsao: dto.previsao ? new Date(dto.previsao) : undefined,
        motivo: dto.motivo,
      },
    });
  }

  /** Recebe a OC: baixa (status recebida) e repõe o saldo do material vinculado. */
  async receber(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.findOne(id, empresaId);
    if (oc.status !== 'aguardando') {
      throw new ConflictException(`OC ${oc.numero} não está aguardando (status: ${oc.status}).`);
    }

    const [atualizada] = await this.prisma.$transaction([
      this.prisma.ordemCompra.update({ where: { id }, data: { status: 'recebida' } }),
      ...(oc.materialId
        ? [
            this.prisma.material.update({
              where: { id: oc.materialId },
              data: { saldo: { increment: oc.quantidade } },
            }),
          ]
        : []),
    ]);
    return atualizada;
  }

  async cancelar(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.findOne(id, empresaId);
    if (oc.status !== 'aguardando') {
      throw new ConflictException(`OC ${oc.numero} não pode ser cancelada (status: ${oc.status}).`);
    }
    return this.prisma.ordemCompra.update({ where: { id }, data: { status: 'cancelada' } });
  }

  /**
   * Sugestão automática de compra do TECIDO/insumo faltante: soma a demanda residual
   * dos pedidos em aberto × consumo por peça (por material), desconta saldo + OCs já
   * abertas, e gera uma OC (idempotente) para cada material em falta.
   */
  async sugerirCompraTecido(empresaId: number) {
    const itens = await this.prisma.pedidoItem.findMany({
      where: { pedido: { empresaId, etapa: { notIn: ['concluido', 'orcamento'] } }, produtoId: { not: null } },
      select: { produtoId: true, quantidade: true, quantidadeExpedida: true },
    });
    const demandaProd = new Map<number, number>();
    for (const it of itens) {
      const pid = it.produtoId as number;
      const r = Math.max(0, it.quantidade - (it.quantidadeExpedida ?? 0));
      if (r > 0) demandaProd.set(pid, (demandaProd.get(pid) ?? 0) + r);
    }
    if (!demandaProd.size) return { criadas: [], jaExistiam: [], mensagem: 'Nenhum pedido em aberto.' };

    const consumos = await this.prisma.consumo.findMany({ where: { produto: { empresaId } }, include: { material: true } });
    const needed = new Map<number, { mat: Material; qtd: number; unidade: string }>();
    for (const c of consumos) {
      const dem = demandaProd.get(c.produtoId);
      if (!dem) continue;
      const q = Number(c.quantidade);
      if (q <= 0) continue;
      const cur = needed.get(c.materialId) ?? { mat: c.material, qtd: 0, unidade: c.unidade || c.material.unidade };
      cur.qtd += dem * q;
      needed.set(c.materialId, cur);
    }
    if (!needed.size) return { criadas: [], jaExistiam: [], mensagem: 'Nenhum produto com receita/tecido vinculado nos pedidos em aberto.' };

    const ocsAbertas = await this.prisma.ordemCompra.findMany({
      where: { fornecedor: { empresaId }, status: 'aguardando', materialId: { in: [...needed.keys()] } },
      select: { materialId: true, quantidade: true, motivo: true },
    });
    const jaOc = new Map<number, number>();
    for (const o of ocsAbertas) if (o.materialId != null) jaOc.set(o.materialId, (jaOc.get(o.materialId) ?? 0) + Number(o.quantidade));

    const fornPadrao =
      (await this.prisma.fornecedor.findFirst({ where: { empresaId, nome: { contains: 'DEFINIR', mode: 'insensitive' } } })) ??
      (await this.prisma.fornecedor.findFirst({ where: { empresaId }, orderBy: { id: 'asc' } }));
    if (!fornPadrao) throw new BadRequestException('Cadastre ao menos um fornecedor (ex.: "A DEFINIR") para gerar a OC.');

    const criadas: Array<{ numero: string; material: string; descricao: string; quantidade: number; unidade: string; valor: number }> = [];
    const jaExistiam: string[] = [];
    for (const [matId, n] of needed) {
      const falta = n.qtd - Number(n.mat.saldo) - (jaOc.get(matId) ?? 0);
      if (falta <= 0.0001) continue;
      const jaSug = ocsAbertas.some((o) => o.materialId === matId && (o.motivo ?? '').startsWith('Sugestão automática'));
      if (jaSug) { jaExistiam.push(n.mat.codigo); continue; }
      const qtd = Number(falta.toFixed(3));
      const valorNum = Number((Number(n.mat.custo) * qtd).toFixed(2));
      const numero = await this.gerarNumero();
      const oc = await this.prisma.ordemCompra.create({
        data: {
          numero, fornecedorId: fornPadrao.id, materialId: matId,
          descricao: `${n.mat.descricao} (${n.mat.codigo})`,
          quantidade: new Prisma.Decimal(qtd.toFixed(3)), unidade: n.unidade,
          valor: new Prisma.Decimal(valorNum.toFixed(2)),
          motivo: 'Sugestão automática (tecido) — pedidos em aberto',
        },
      });
      criadas.push({ numero: oc.numero, material: n.mat.codigo, descricao: n.mat.descricao, quantidade: qtd, unidade: n.unidade, valor: valorNum });
    }
    const mensagem = criadas.length
      ? `${criadas.length} ordem(ns) de compra criada(s) para o fornecedor "${fornPadrao.nome}". Ajuste o fornecedor/preço em Compras.`
      : jaExistiam.length
        ? 'Já havia OC de sugestão aberta para o(s) material(is) em falta.'
        : 'Estoque suficiente — nada a comprar.';
    return { criadas, jaExistiam, fornecedor: fornPadrao.nome, mensagem };
  }

  private async gerarNumero(): Promise<string> {
    const existentes = await this.prisma.ordemCompra.findMany({ select: { numero: true } });
    return proximoSequencial('OC', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }
}
