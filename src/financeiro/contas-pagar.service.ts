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

type FilialResumo = { id: number; nome: string; cnpj: string | null };
export type ContaPagarView = ContaPagar & { status: TituloStatus; saldo: string; filial?: FilialResumo | null };

@Injectable()
export class ContasPagarService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number, status?: TituloStatus): Promise<ContaPagarView[]> {
    const titulos = await this.prisma.contaPagar.findMany({
      where: { empresaId },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
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
    // Filial/CNPJ pagador: usa a informada (validando a empresa); senão a matriz.
    let filialId = dto.filialId;
    if (filialId) {
      const fil = await this.prisma.filial.findUnique({ where: { id: filialId } });
      if (!fil || fil.empresaId !== empresaId) throw new NotFoundException(`Filial ${filialId} não encontrada.`);
    } else {
      const matriz = await this.prisma.filial.findFirst({ where: { empresaId }, orderBy: [{ matriz: 'desc' }, { id: 'asc' }] });
      filialId = matriz?.id;
    }
    const vencimento = new Date(dto.vencimento);
    const valor = new Prisma.Decimal(dto.valor);
    const titulo = await this.prisma.contaPagar.create({
      data: {
        empresaId,
        filialId,
        fornecedorId: dto.fornecedorId,
        categoria: dto.categoria,
        referencia: dto.referencia,
        vencimento,
        valor,
        pago: 0,
        status: calcularStatusTitulo(valor, new Prisma.Decimal(0), vencimento),
      },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
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
    if (dto.filialId) {
      const fil = await this.prisma.filial.findUnique({ where: { id: dto.filialId } });
      if (!fil || fil.empresaId !== empresaId) throw new NotFoundException(`Filial ${dto.filialId} não encontrada.`);
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
        filialId: dto.filialId ?? t.filialId,
        vencimento,
        valor,
        status: calcularStatusTitulo(valor, t.pago, vencimento),
      },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
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

  /** Divide um título em várias parcelas (uma conta por parcela). Só se ainda não houve baixa. */
  async parcelar(id: number, empresaId: number, parcelas: { vencimento: string; valor: number }[]): Promise<{ criadas: number }> {
    const t = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    if (t.pago.greaterThan(0)) throw new BadRequestException('Este título já tem baixa; não é possível parcelar.');
    if (!parcelas || parcelas.length < 2) throw new BadRequestException('Informe ao menos 2 parcelas.');
    const n = parcelas.length;
    const baseRef = (t.referencia || 'Título').replace(/\s*\(\d+\/\d+\)\s*$/, '');
    await this.prisma.$transaction(async (tx) => {
      // A 1ª parcela reaproveita o título original; as demais são criadas.
      for (let i = 0; i < n; i++) {
        const pc = parcelas[i];
        const venc = new Date(pc.vencimento);
        const valor = new Prisma.Decimal(Number(pc.valor).toFixed(2));
        const dados = {
          empresaId,
          filialId: t.filialId,
          fornecedorId: t.fornecedorId,
          categoria: t.categoria,
          referencia: `${baseRef} (${i + 1}/${n})`,
          vencimento: venc,
          valor,
          pago: new Prisma.Decimal(0),
          status: calcularStatusTitulo(valor, new Prisma.Decimal(0), venc),
        };
        if (i === 0) await tx.contaPagar.update({ where: { id }, data: dados });
        else await tx.contaPagar.create({ data: dados });
      }
    });
    return { criadas: n };
  }

  private comStatus(t: ContaPagar & { filial?: FilialResumo | null }): ContaPagarView {
    return {
      ...t,
      status: calcularStatusTitulo(t.valor, t.pago, t.vencimento),
      saldo: t.valor.minus(t.pago).toFixed(2),
    };
  }
}
