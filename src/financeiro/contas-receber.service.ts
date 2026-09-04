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

type FilialResumo = { id: number; nome: string; cnpj: string | null };
/** Título a receber com status recalculado e saldo em aberto. */
export type ContaReceberView = ContaReceber & { status: TituloStatus; saldo: string; filial?: FilialResumo | null };

/**
 * Regra de comissão automática: ao QUITAR uma venda, gera comissão "a receber"
 * (registro em Comissões, status "A pagar") para cada participante, calculada
 * sobre o LÍQUIDO da venda (valor − imposto da filial emissora).
 * Para mudar os participantes ou o percentual, edite esta constante.
 */
const REGRA_COMISSAO_VENDA: Array<{ vendedor: string; percentual: number }> = [
  { vendedor: 'HERBERTH', percentual: 0.025 },
  { vendedor: 'MARCELLO GAMERO', percentual: 0.025 },
];

@Injectable()
export class ContasReceberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera as comissões da venda quando o título a receber é totalmente quitado.
   * Idempotente (flag comissaoGerada). Só comissiona títulos ligados a um pedido
   * (venda); o líquido usa o imposto (%) configurado na filial emissora.
   */
  private async gerarComissoesVenda(tituloId: number, empresaId: number): Promise<void> {
    const t = await this.prisma.contaReceber.findUnique({
      where: { id: tituloId },
      include: { filial: { select: { impostoVendaPercent: true } } },
    });
    if (!t || t.comissaoGerada) return;
    if (t.valor.minus(t.pago).greaterThan(0.005)) return; // ainda não quitado
    if (!t.pedidoId) {
      // Título sem venda vinculada: marca como processado p/ não reavaliar sempre.
      await this.prisma.contaReceber.update({ where: { id: tituloId }, data: { comissaoGerada: true } });
      return;
    }
    const impostoPct = Number(t.filial?.impostoVendaPercent ?? 0);
    const bruto = Number(t.valor);
    const liquido = Number((bruto * (1 - impostoPct / 100)).toFixed(2));
    // Comissão do REPRESENTANTE da conta (representante + % definidos no pedido).
    const ped = await this.prisma.pedido.findUnique({
      where: { id: t.pedidoId },
      select: { comissaoRepresentante: true, comissaoPercent: true, comissaoComImposto: true },
    });
    const repNome = (ped?.comissaoRepresentante ?? '').trim();
    const repPct = Number(ped?.comissaoPercent ?? 0); // ex.: 5 => 5%
    // Base do representante: "com imposto" = valor cheio (bruto); senão = líquido.
    const baseRep = ped?.comissaoComImposto ? bruto : liquido;
    await this.prisma.$transaction(async (tx) => {
      for (const r of REGRA_COMISSAO_VENDA) {
        const comissao = Number((liquido * r.percentual).toFixed(2));
        await tx.comissao.create({
          data: {
            empresaId,
            pedidoId: t.pedidoId as number,
            vendedor: r.vendedor,
            valorVenda: new Prisma.Decimal(liquido),
            percentual: new Prisma.Decimal(r.percentual),
            comissao: new Prisma.Decimal(comissao),
            statusPgto: 'A pagar',
            baseImposto: 'liquido',
          },
        });
      }
      // Gera a comissão do representante, se houver representante + % no pedido.
      if (repNome && repPct > 0) {
        const frac = repPct / 100;
        const comissaoRep = Number((baseRep * frac).toFixed(2));
        await tx.comissao.create({
          data: {
            empresaId,
            pedidoId: t.pedidoId as number,
            vendedor: repNome,
            valorVenda: new Prisma.Decimal(baseRep),
            percentual: new Prisma.Decimal(frac),
            comissao: new Prisma.Decimal(comissaoRep),
            statusPgto: 'A pagar',
            baseImposto: ped?.comissaoComImposto ? 'bruto' : 'liquido',
          },
        });
      }
      await tx.contaReceber.update({ where: { id: tituloId }, data: { comissaoGerada: true } });
    });
  }

  async findAll(empresaId: number, status?: TituloStatus): Promise<ContaReceberView[]> {
    const titulos = await this.prisma.contaReceber.findMany({
      where: { empresaId },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
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
    let filialId = dto.filialId;
    if (filialId) {
      const fil = await this.prisma.filial.findUnique({ where: { id: filialId } });
      if (!fil || fil.empresaId !== empresaId) throw new NotFoundException(`Filial ${filialId} não encontrada.`);
    }
    const vencimento = new Date(dto.vencimento);
    const valor = new Prisma.Decimal(dto.valor);
    const titulo = await this.prisma.contaReceber.create({
      data: {
        empresaId,
        filialId,
        documento: dto.documento,
        clienteId: dto.clienteId,
        pedidoId: dto.pedidoId,
        vencimento,
        valor,
        pago: 0,
        status: calcularStatusTitulo(valor, new Prisma.Decimal(0), vencimento),
      },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
    });
    return this.comStatus(titulo);
  }

  /** Baixa (recebe) o título — parcial ou total. */
  async baixar(id: number, empresaId: number, valorBaixa?: number, juros?: number): Promise<ContaReceberView> {
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
        `Valor da baixa (${baixa.toFixed(2)}) excede o saldo (${restante.toFixed(2)}). Se recebeu a mais por atraso, informe a diferença no campo Juros/multa.`,
      );
    }
    const jurosDec = juros != null && juros > 0 ? new Prisma.Decimal(juros) : new Prisma.Decimal(0);
    const novoPago = titulo.pago.plus(baixa);
    const atualizado = await this.prisma.contaReceber.update({
      where: { id },
      data: {
        pago: novoPago,
        juros: titulo.juros.plus(jurosDec),
        status: calcularStatusTitulo(titulo.valor, novoPago, titulo.vencimento),
      },
    });
    // Regra de comissão automática ao quitar (não bloqueia a baixa se falhar).
    if (novoPago.greaterThanOrEqualTo(titulo.valor)) {
      try { await this.gerarComissoesVenda(id, empresaId); } catch { /* segue a baixa */ }
    }
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

  /** Exclusão em lote (só títulos da empresa). */
  async excluirLote(ids: number[], empresaId: number): Promise<{ removidos: number }> {
    const list = (ids || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) return { removidos: 0 };
    const r = await this.prisma.contaReceber.deleteMany({ where: { id: { in: list }, empresaId } });
    return { removidos: r.count };
  }

  /** Baixa (recebimento total) em lote dos títulos selecionados. */
  async baixarLote(ids: number[], empresaId: number): Promise<{ baixados: number }> {
    const list = (ids || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) return { baixados: 0 };
    const titulos = await this.prisma.contaReceber.findMany({ where: { id: { in: list }, empresaId } });
    let baixados = 0;
    for (const t of titulos) {
      if (t.valor.minus(t.pago).lessThanOrEqualTo(0)) continue;
      await this.prisma.contaReceber.update({
        where: { id: t.id },
        data: { pago: t.valor, status: calcularStatusTitulo(t.valor, t.valor, t.vencimento) },
      });
      try { await this.gerarComissoesVenda(t.id, empresaId); } catch { /* segue */ }
      baixados++;
    }
    return { baixados };
  }

  private comStatus(t: ContaReceber): ContaReceberView {
    return {
      ...t,
      status: calcularStatusTitulo(t.valor, t.pago, t.vencimento),
      saldo: t.valor.minus(t.pago).toFixed(2),
    };
  }
}
