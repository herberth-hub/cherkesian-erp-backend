import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContaPagar, Prisma, TituloStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContaPagarDto } from './dto/create-conta-pagar.dto';
import { UpdateContaPagarDto } from './dto/update-conta-pagar.dto';
import { calcularStatusTitulo } from './titulo-status.util';

export type ContaPagarView = ContaPagar & { status: TituloStatus; saldo: string };

@Injectable()
export class ContasPagarService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number, status?: TituloStatus): Promise<ContaPagarView[]> {
    const titulos = await this.prisma.contaPagar.findMany({
      where: { empresaId },
      orderBy: { vencimento: 'asc' },
    });
    return titulos.map((t) => this.comStatus(t)).filter((t) => !status || t.status === status);
  }

  async create(dto: CreateContaPagarDto, empresaId: number): Promise<ContaPagarView> {
    if (dto.fornecedorId) {
      const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
      if (!fornecedor || fornecedor.empresaId !== empresaId) {
        throw new NotFoundException(`Fornecedor ${dto.fornecedorId} não encontrado.`);
      }
    }
    const vencimento = new Date(dto.vencimento);
    const valor = new Prisma.Decimal(dto.valor);
    const titulo = await this.prisma.contaPagar.create({
      data: {
        empresaId,
        fornecedorId: dto.fornecedorId,
        categoria: dto.categoria,
        referencia: dto.referencia,
        vencimento,
        valor,
        pago: 0,
        status: calcularStatusTitulo(valor, new Prisma.Decimal(0), vencimento),
      },
    });
    return this.comStatus(titulo);
  }

  async baixar(id: number, empresaId: number, valorBaixa?: number): Promise<ContaPagarView> {
    const titulo = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!titulo || titulo.empresaId !== empresaId) {
      throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
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
    const atualizado = await this.prisma.contaPagar.update({
      where: { id },
      data: {
        pago: novoPago,
        status: calcularStatusTitulo(titulo.valor, novoPago, titulo.vencimento),
      },
    });
    return this.comStatus(atualizado);
  }

  async editar(id: number, dto: UpdateContaPagarDto, empresaId: number): Promise<ContaPagarView> {
    const t = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) {
      throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    }
    if (dto.fornecedorId) {
      const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
      if (!fornecedor || fornecedor.empresaId !== empresaId) {
        throw new NotFoundException(`Fornecedor ${dto.fornecedorId} não encontrado.`);
      }
    }
    const vencimento = dto.vencimento ? new Date(dto.vencimento) : t.vencimento;
    const valor = dto.valor != null ? new Prisma.Decimal(dto.valor) : t.valor;
    if (valor.lessThan(t.pago)) {
      throw new BadRequestException(`O valor não pode ser menor que o já pago (${t.pago.toFixed(2)}).`);
    }
    const atualizado = await this.prisma.contaPagar.update({
      where: { id },
      data: {
        categoria: dto.categoria ?? t.categoria,
        referencia: dto.referencia ?? t.referencia,
        fornecedorId: dto.fornecedorId ?? t.fornecedorId,
        vencimento,
        valor,
        status: calcularStatusTitulo(valor, t.pago, vencimento),
      },
    });
    return this.comStatus(atualizado);
  }

  async excluir(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    const t = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) {
      throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    }
    await this.prisma.contaPagar.delete({ where: { id } });
    return { removido: true, id };
  }

  private comStatus(t: ContaPagar): ContaPagarView {
    return {
      ...t,
      status: calcularStatusTitulo(t.valor, t.pago, t.vencimento),
      saldo: t.valor.minus(t.pago).toFixed(2),
    };
  }
}
