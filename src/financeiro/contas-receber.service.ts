import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContaReceber, Prisma, TituloStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContaReceberDto } from './dto/create-conta-receber.dto';
import { UpdateContaReceberDto } from './dto/update-conta-receber.dto';
import { calcularStatusTitulo } from './titulo-status.util';

/** Título a receber com status recalculado e saldo em aberto. */
export type ContaReceberView = ContaReceber & { status: TituloStatus; saldo: string };

@Injectable()
export class ContasReceberService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number, status?: TituloStatus): Promise<ContaReceberView[]> {
    const titulos = await this.prisma.contaReceber.findMany({
      where: { empresaId },
      orderBy: { vencimento: 'asc' },
    });
    return titulos.map((t) => this.comStatus(t)).filter((t) => !status || t.status === status);
  }

  async create(dto: CreateContaReceberDto, empresaId: number): Promise<ContaReceberView> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }
    if (dto.pedidoId) {
      const pedido = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId } });
      if (!pedido || pedido.empresaId !== empresaId) {
        throw new NotFoundException(`Pedido ${dto.pedidoId} não encontrado.`);
      }
    }
    const vencimento = new Date(dto.vencimento);
    const valor = new Prisma.Decimal(dto.valor);
    const titulo = await this.prisma.contaReceber.create({
      data: {
        empresaId,
        clienteId: dto.clienteId,
        pedidoId: dto.pedidoId,
        vencimento,
        valor,
        pago: 0,
        status: calcularStatusTitulo(valor, new Prisma.Decimal(0), vencimento),
      },
    });
    return this.comStatus(titulo);
  }

  /** Baixa (recebe) o título — parcial ou total. */
  async baixar(id: number, empresaId: number, valorBaixa?: number): Promise<ContaReceberView> {
    const titulo = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (!titulo || titulo.empresaId !== empresaId) {
      throw new NotFoundException(`Título a receber ${id} não encontrado.`);
    }
    const restante = titulo.valor.minus(titulo.pago);
    if (restante.lessThanOrEqualTo(0)) {
      throw new ConflictException('Título já está quitado.');
    }
    const baixa = valorBaixa != null ? new Prisma.Decimal(valorBaixa) : restante;
    if (baixa.greaterThan(restante)) {
      throw new BadRequestException(
        `Valor da baixa (${baixa.toFixed(2)}) excede o saldo (${restante.toFixed(2)}).`,
      );
    }
    const novoPago = titulo.pago.plus(baixa);
    const atualizado = await this.prisma.contaReceber.update({
      where: { id },
      data: {
        pago: novoPago,
        status: calcularStatusTitulo(titulo.valor, novoPago, titulo.vencimento),
      },
    });
    return this.comStatus(atualizado);
  }

  async editar(id: number, dto: UpdateContaReceberDto, empresaId: number): Promise<ContaReceberView> {
    const t = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) {
      throw new NotFoundException(`Título a receber ${id} não encontrado.`);
    }
    const vencimento = dto.vencimento ? new Date(dto.vencimento) : t.vencimento;
    const valor = dto.valor != null ? new Prisma.Decimal(dto.valor) : t.valor;
    if (valor.lessThan(t.pago)) {
      throw new BadRequestException(`O valor não pode ser menor que o já recebido (${t.pago.toFixed(2)}).`);
    }
    const atualizado = await this.prisma.contaReceber.update({
      where: { id },
      data: { vencimento, valor, status: calcularStatusTitulo(valor, t.pago, vencimento) },
    });
    return this.comStatus(atualizado);
  }

  async excluir(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    const t = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) {
      throw new NotFoundException(`Título a receber ${id} não encontrado.`);
    }
    await this.prisma.contaReceber.delete({ where: { id } });
    return { removido: true, id };
  }

  private comStatus(t: ContaReceber): ContaReceberView {
    return {
      ...t,
      status: calcularStatusTitulo(t.valor, t.pago, t.vencimento),
      saldo: t.valor.minus(t.pago).toFixed(2),
    };
  }
}
