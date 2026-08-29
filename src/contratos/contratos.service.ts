import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoDto, ContratoItemDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';

/**
 * Contratos: clientes com tabela de preço fixa por produto + condições comerciais.
 * Base para automação (robô): o cliente pede pelo robô e o pedido é montado com o
 * produto + preço tabelado + condição de pagamento do contrato dele.
 */
@Injectable()
export class ContratosService {
  constructor(private readonly prisma: PrismaService) {}

  private parseData(s?: string): Date | null {
    if (!s) return null;
    const d = new Date(s.length <= 10 ? `${s}T00:00:00.000Z` : s);
    return isNaN(d.getTime()) ? null : d;
  }

  private mapItens(itens?: ContratoItemDto[]) {
    return (itens ?? [])
      .filter((it) => (it.descricao ?? '').trim() !== '')
      .map((it) => ({
        produtoId: it.produtoId ?? null,
        codigo: it.codigo?.trim() || null,
        descricao: it.descricao.trim(),
        preco: new Prisma.Decimal(it.preco ?? 0),
        unidade: it.unidade?.trim() || 'UN',
        obs: it.obs?.trim() || null,
      }));
  }

  async findAll(empresaId: number) {
    const contratos = await this.prisma.contrato.findMany({
      where: { empresaId },
      orderBy: [{ ativo: 'desc' }, { id: 'desc' }],
      include: {
        cliente: { select: { id: true, nome: true, fantasia: true, cnpjCpf: true, cidadeUf: true } },
        filial: { select: { id: true, nome: true, cnpj: true } },
        _count: { select: { itens: true } },
      },
    });
    return contratos;
  }

  async findOne(id: number, empresaId: number) {
    const c = await this.prisma.contrato.findUnique({
      where: { id },
      include: {
        cliente: { select: { id: true, nome: true, fantasia: true, cnpjCpf: true, cidadeUf: true, telefone: true, email: true, contato: true } },
        filial: { select: { id: true, nome: true, cnpj: true } },
        itens: { orderBy: { id: 'asc' } },
      },
    });
    if (!c || c.empresaId !== empresaId) throw new NotFoundException(`Contrato ${id} não encontrado.`);
    return c;
  }

  async create(dto: CreateContratoDto, empresaId: number) {
    const cliente = await this.prisma.cliente.findFirst({ where: { id: dto.clienteId, empresaId }, select: { id: true } });
    if (!cliente) throw new BadRequestException('Cliente não encontrado nesta empresa.');
    return this.prisma.contrato.create({
      data: {
        empresaId,
        clienteId: dto.clienteId,
        filialId: dto.filialId ?? null,
        vendedor: dto.vendedor?.trim() || null,
        numero: dto.numero?.trim() || null,
        descricao: dto.descricao?.trim() || null,
        formaPagamento: dto.formaPagamento?.trim() || null,
        condicaoPagamento: dto.condicaoPagamento?.trim() || null,
        prazoEntrega: dto.prazoEntrega?.trim() || null,
        transportadora: dto.transportadora?.trim() || null,
        vigenciaInicio: this.parseData(dto.vigenciaInicio),
        vigenciaFim: this.parseData(dto.vigenciaFim),
        observacoes: dto.observacoes?.trim() || null,
        ativo: dto.ativo ?? true,
        itens: { create: this.mapItens(dto.itens) },
      },
      include: { itens: true },
    });
  }

  async update(id: number, dto: UpdateContratoDto, empresaId: number) {
    await this.findOne(id, empresaId);
    if (dto.clienteId != null) {
      const cliente = await this.prisma.cliente.findFirst({ where: { id: dto.clienteId, empresaId }, select: { id: true } });
      if (!cliente) throw new BadRequestException('Cliente não encontrado nesta empresa.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.contrato.update({
        where: { id },
        data: {
          clienteId: dto.clienteId ?? undefined,
          filialId: dto.filialId !== undefined ? (dto.filialId ?? null) : undefined,
          vendedor: dto.vendedor !== undefined ? dto.vendedor?.trim() || null : undefined,
          numero: dto.numero !== undefined ? dto.numero?.trim() || null : undefined,
          descricao: dto.descricao !== undefined ? dto.descricao?.trim() || null : undefined,
          formaPagamento: dto.formaPagamento !== undefined ? dto.formaPagamento?.trim() || null : undefined,
          condicaoPagamento: dto.condicaoPagamento !== undefined ? dto.condicaoPagamento?.trim() || null : undefined,
          prazoEntrega: dto.prazoEntrega !== undefined ? dto.prazoEntrega?.trim() || null : undefined,
          transportadora: dto.transportadora !== undefined ? dto.transportadora?.trim() || null : undefined,
          vigenciaInicio: dto.vigenciaInicio !== undefined ? this.parseData(dto.vigenciaInicio) : undefined,
          vigenciaFim: dto.vigenciaFim !== undefined ? this.parseData(dto.vigenciaFim) : undefined,
          observacoes: dto.observacoes !== undefined ? dto.observacoes?.trim() || null : undefined,
          ativo: dto.ativo ?? undefined,
        },
      });
      // Se veio a lista de itens, substitui todos.
      if (dto.itens !== undefined) {
        await tx.contratoItem.deleteMany({ where: { contratoId: id } });
        const itens = this.mapItens(dto.itens);
        if (itens.length) {
          await tx.contratoItem.createMany({ data: itens.map((it) => ({ ...it, contratoId: id })) });
        }
      }
      return tx.contrato.findUnique({ where: { id }, include: { itens: { orderBy: { id: 'asc' } } } });
    });
  }

  async setAtivo(id: number, empresaId: number, ativo: boolean) {
    await this.findOne(id, empresaId);
    return this.prisma.contrato.update({ where: { id }, data: { ativo } });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    await this.prisma.contrato.delete({ where: { id } }); // itens caem por ON DELETE CASCADE
    return { ok: true };
  }
}
