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
// O boleto (base64) NÃO vai na listagem (baixa via endpoint próprio) — só o flag temBoleto.
export type ContaPagarView = Omit<ContaPagar, 'boleto'> & { status: TituloStatus; saldo: string; temBoleto: boolean; filial?: FilialResumo | null };

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
        boleto: dto.boleto || null,
        boletoNome: dto.boleto ? (dto.boletoNome || 'boleto') : null,
        status: calcularStatusTitulo(valor, new Prisma.Decimal(0), vencimento),
      },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
    });
    return this.comStatus(titulo);
  }

  async baixar(id: number, empresaId: number, valorBaixa?: number, banco?: string, juros?: number): Promise<ContaPagarView> {
    const titulo = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!titulo || titulo.empresaId !== empresaId) {
      throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    }
    const restante = titulo.valor.minus(titulo.pago);
    if (restante.lessThanOrEqualTo(0)) {
      throw new ConflictException('Título já está quitado.');
    }
    const baixa = valorBaixa != null ? new Prisma.Decimal(valorBaixa) : restante;
    // O valor da baixa é o PRINCIPAL (limitado ao saldo). Juros/multa entram à parte.
    if (baixa.greaterThan(restante)) {
      throw new BadRequestException(
        `Valor da baixa (${baixa.toFixed(2)}) excede o saldo (${restante.toFixed(2)}). Se pagou a mais por atraso, informe a diferença no campo Juros/multa.`,
      );
    }
    const jurosDec = juros != null && juros > 0 ? new Prisma.Decimal(juros) : new Prisma.Decimal(0);
    const novoPago = titulo.pago.plus(baixa);
    const bancoTxt = (banco || '').trim();
    const atualizado = await this.prisma.contaPagar.update({
      where: { id },
      data: {
        pago: novoPago,
        juros: titulo.juros.plus(jurosDec),
        status: calcularStatusTitulo(titulo.valor, novoPago, titulo.vencimento),
        ...(bancoTxt ? { bancoPagto: bancoTxt } : {}),
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
        // boleto: undefined = não mexe; '' = remove; string = substitui.
        ...(dto.boleto !== undefined
          ? { boleto: dto.boleto || null, boletoNome: dto.boleto ? (dto.boletoNome || t.boletoNome || 'boleto') : null }
          : {}),
        status: calcularStatusTitulo(valor, t.pago, vencimento),
      },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
    });
    return this.comStatus(atualizado);
  }

  /** Baixa o arquivo do boleto anexado (PDF/imagem) para visualizar/imprimir. */
  async getBoleto(id: number, empresaId: number): Promise<{ content: Buffer; contentType: string; filename: string }> {
    const t = await this.prisma.contaPagar.findUnique({ where: { id }, select: { empresaId: true, boleto: true, boletoNome: true } });
    if (!t || t.empresaId !== empresaId) throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    if (!t.boleto) throw new NotFoundException('Este título não tem boleto anexado.');
    const m = /^data:([^;]+);base64,(.*)$/s.exec(t.boleto);
    const contentType = m ? m[1] : 'application/octet-stream';
    const b64 = m ? m[2] : t.boleto;
    const content = Buffer.from(b64, 'base64');
    const ext = contentType.includes('pdf') ? 'pdf' : /png/.test(contentType) ? 'png' : /jpe?g/.test(contentType) ? 'jpg' : 'bin';
    const filename = t.boletoNome && /\.[a-z0-9]{2,4}$/i.test(t.boletoNome) ? t.boletoNome : `boleto-${id}.${ext}`;
    return { content, contentType, filename };
  }

  async excluir(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    const t = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) {
      throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    }
    await this.prisma.contaPagar.delete({ where: { id } });
    return { removido: true, id };
  }

  /** Exclusão em lote (só títulos da empresa). */
  async excluirLote(ids: number[], empresaId: number): Promise<{ removidos: number }> {
    const list = (ids || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) return { removidos: 0 };
    const r = await this.prisma.contaPagar.deleteMany({ where: { id: { in: list }, empresaId } });
    return { removidos: r.count };
  }

  /** Baixa (quitação total) em lote dos títulos selecionados. */
  async baixarLote(ids: number[], empresaId: number, banco?: string): Promise<{ baixados: number }> {
    const list = (ids || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) return { baixados: 0 };
    const titulos = await this.prisma.contaPagar.findMany({ where: { id: { in: list }, empresaId } });
    const bancoTxt = (banco || '').trim();
    let baixados = 0;
    for (const t of titulos) {
      if (t.valor.minus(t.pago).lessThanOrEqualTo(0)) continue; // já quitado
      await this.prisma.contaPagar.update({
        where: { id: t.id },
        data: { pago: t.valor, status: calcularStatusTitulo(t.valor, t.valor, t.vencimento), ...(bancoTxt ? { bancoPagto: bancoTxt } : {}) },
      });
      baixados++;
    }
    return { baixados };
  }

  /** Divide um título em várias parcelas (uma conta por parcela). Só se ainda não houve baixa. */
  async parcelar(id: number, empresaId: number, parcelas: { vencimento: string; valor: number }[]): Promise<{ criadas: number }> {
    const t = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) throw new NotFoundException(`Título a pagar ${id} não encontrado.`);
    if (t.pago.greaterThan(0)) throw new BadRequestException('Este título já tem baixa; não é possível parcelar.');
    if (!parcelas || parcelas.length < 2) throw new BadRequestException('Informe ao menos 2 parcelas.');
    const n = parcelas.length;
    const baseRef = (t.referencia || 'Título').replace(/\s*\(\d+\/\d+\)\s*$/, '');
    const linha = (i: number) => {
      const pc = parcelas[i];
      const venc = new Date(pc.vencimento);
      const valor = new Prisma.Decimal(Number(pc.valor).toFixed(2));
      return {
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
    };
    // A 1ª parcela reaproveita o título original; as demais entram em UM createMany
    // (evita dezenas de round-trips numa transação — que estourava o timeout em 33x/40x).
    await this.prisma.$transaction(
      async (tx) => {
        await tx.contaPagar.update({ where: { id }, data: linha(0) });
        if (n > 1) {
          const resto = Array.from({ length: n - 1 }, (_, k) => linha(k + 1));
          await tx.contaPagar.createMany({ data: resto });
        }
      },
      { timeout: 20000, maxWait: 10000 },
    );
    return { criadas: n };
  }

  private comStatus(t: ContaPagar & { filial?: FilialResumo | null }): ContaPagarView {
    const { boleto, ...rest } = t;
    return {
      ...rest,
      temBoleto: !!boleto,
      status: calcularStatusTitulo(t.valor, t.pago, t.vencimento),
      saldo: t.valor.minus(t.pago).toFixed(2),
    };
  }
}
