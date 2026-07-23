import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotaEntradaDto } from './dto/create-nota-entrada.dto';

const digitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Notas de Entrada — NF de compra recebida do fornecedor.
 * Ao registrar, opcionalmente: (a) dá entrada no estoque de matéria-prima
 * (soma ao saldo dos materiais vinculados) e (b) gera um título no A Pagar.
 * Rastreador: consulta na Focus as NF-e emitidas contra o CNPJ (distribuição).
 */
@Injectable()
export class NotasEntradaService {
  private readonly logger = new Logger(NotasEntradaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  findAll(empresaId: number) {
    return this.prisma.notaEntrada.findMany({
      where: { empresaId },
      include: { fornecedor: { select: { id: true, nome: true } }, itens: true },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const nota = await this.prisma.notaEntrada.findUnique({
      where: { id },
      include: { fornecedor: true, itens: true },
    });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota de entrada ${id} não encontrada.`);
    return nota;
  }

  async create(dto: CreateNotaEntradaDto, empresaId: number, criadoPor: string) {
    if (dto.fornecedorId) {
      const f = await this.prisma.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
      if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Fornecedor ${dto.fornecedorId} não encontrado.`);
    }
    if (dto.chave && digitos(dto.chave).length === 44) {
      const existe = await this.prisma.notaEntrada.findUnique({ where: { chave: digitos(dto.chave) } });
      if (existe) throw new BadRequestException(`Esta NF (chave ...${digitos(dto.chave).slice(-6)}) já foi registrada.`);
    }

    const valor = dto.itens.reduce((s, it) => s + it.quantidade * it.valorUnit, 0);

    return this.prisma.$transaction(async (tx) => {
      // Título a pagar (opcional)
      let contaPagarId: number | undefined;
      if (dto.gerarContaPagar) {
        const cp = await tx.contaPagar.create({
          data: {
            empresaId,
            fornecedorId: dto.fornecedorId,
            categoria: dto.categoria || 'Matéria-prima',
            referencia: `NF entrada ${dto.numero}`,
            vencimento: dto.vencimento ? new Date(dto.vencimento) : new Date(),
            valor: new Prisma.Decimal(valor.toFixed(2)),
          },
        });
        contaPagarId = cp.id;
      }

      const nota = await tx.notaEntrada.create({
        data: {
          empresaId,
          fornecedorId: dto.fornecedorId,
          numero: dto.numero,
          serie: dto.serie,
          chave: dto.chave ? digitos(dto.chave) : undefined,
          cnpjEmitente: dto.cnpjEmitente ? digitos(dto.cnpjEmitente) : undefined,
          nomeEmitente: dto.nomeEmitente,
          emitidaEm: dto.emitidaEm ? new Date(dto.emitidaEm) : undefined,
          valor: new Prisma.Decimal(valor.toFixed(2)),
          origem: 'manual',
          lancadaEstoque: !!dto.lancarEstoque,
          contaPagarId,
          obs: dto.obs,
          criadoPor,
          itens: {
            create: dto.itens.map((it) => ({
              materialId: it.materialId,
              descricao: it.descricao,
              ncm: it.ncm,
              quantidade: new Prisma.Decimal(it.quantidade),
              unidade: it.unidade || 'un',
              valorUnit: new Prisma.Decimal(it.valorUnit),
            })),
          },
        },
        include: { itens: true },
      });

      // Entrada no estoque de matéria-prima (soma ao saldo dos materiais vinculados)
      const lancados: string[] = [];
      if (dto.lancarEstoque) {
        for (const it of dto.itens) {
          if (!it.materialId) continue;
          const mat = await tx.material.findUnique({ where: { id: it.materialId } });
          if (!mat || mat.empresaId !== empresaId) continue;
          await tx.material.update({
            where: { id: it.materialId },
            data: { saldo: { increment: new Prisma.Decimal(it.quantidade) } },
          });
          lancados.push(mat.codigo);
        }
      }

      return { ...nota, contaPagarGerada: !!contaPagarId, materiaisAtualizados: lancados };
    });
  }

  async remove(id: number, empresaId: number) {
    const nota = await this.findOne(id, empresaId);
    return this.prisma.$transaction(async (tx) => {
      // Estorna o estoque, se foi lançado
      if (nota.lancadaEstoque) {
        for (const it of nota.itens) {
          if (!it.materialId) continue;
          await tx.material.update({
            where: { id: it.materialId },
            data: { saldo: { decrement: it.quantidade } },
          }).catch(() => undefined);
        }
      }
      // Remove o título a pagar gerado, se ainda existir e não tiver baixa
      if (nota.contaPagarId) {
        const cp = await tx.contaPagar.findUnique({ where: { id: nota.contaPagarId } });
        if (cp && Number(cp.pago) === 0) await tx.contaPagar.delete({ where: { id: cp.id } }).catch(() => undefined);
      }
      await tx.notaEntrada.delete({ where: { id } });
      return { removido: true, id };
    });
  }

  // ===== Rastreador SEFAZ (Focus — distribuição de NF-e) =====

  private async tokenEmpresa(empresaId: number): Promise<{ token: string; host: string; cnpj: string }> {
    const matriz = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    const token = matriz?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (!token) throw new BadRequestException('Provedor NF-e não configurado (FOCUS_NFE_TOKEN).');
    const cnpj = digitos(matriz?.cnpj);
    if (!cnpj) throw new BadRequestException('CNPJ da matriz não configurado.');
    const host = this.config.get<string>('NFE_AMBIENTE') === 'producao'
      ? 'api.focusnfe.com.br'
      : 'homologacao.focusnfe.com.br';
    return { token, host, cnpj };
  }

  private focusHeaders(token: string) {
    return { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64') };
  }

  /** Lista as NF-e emitidas contra o CNPJ (as já importadas vêm marcadas). */
  async sefazListar(empresaId: number) {
    const { token, host, cnpj } = await this.tokenEmpresa(empresaId);
    const url = `https://${host}/v2/nfes_recebidas?cnpj=${cnpj}`;
    let lista: any[] = [];
    try {
      const res = await fetch(url, { headers: this.focusHeaders(token) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, motivo: `Focus HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, notas: [] };
      }
      lista = Array.isArray(body) ? body : ((body as { nfes?: any[] }).nfes ?? []);
    } catch (err) {
      this.logger.error(`Falha ao consultar NF-e recebidas: ${String(err)}`);
      return { ok: false, motivo: 'Erro de comunicação com o provedor.', notas: [] };
    }

    const chaves = lista.map((n) => digitos(n.chave_nfe || n.chave)).filter(Boolean);
    const jaImport = new Set(
      (await this.prisma.notaEntrada.findMany({ where: { empresaId, chave: { in: chaves } }, select: { chave: true } }))
        .map((n) => n.chave),
    );
    const notas = lista.map((n) => {
      const chave = digitos(n.chave_nfe || n.chave);
      return {
        chave,
        numero: n.numero ?? n.nfe ?? '—',
        emitente: n.nome_emitente ?? n.emitente ?? '—',
        cnpjEmitente: digitos(n.cnpj_emitente || n.cnpj),
        valor: Number(n.valor_total ?? n.valor ?? 0),
        data: n.data_emissao ?? n.data ?? null,
        situacao: n.situacao ?? n.status ?? '—',
        importada: jaImport.has(chave),
      };
    });
    return { ok: true, cnpj, quantidade: notas.length, notas };
  }

  /** Detalhe (JSON) de uma NF-e recebida pela chave — para pré-preencher a entrada. */
  async sefazDetalhe(empresaId: number, chave: string) {
    const { token, host } = await this.tokenEmpresa(empresaId);
    const ch = digitos(chave);
    const url = `https://${host}/v2/nfes_recebidas/${ch}/json`;
    const res = await fetch(url, { headers: this.focusHeaders(token) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(`Focus HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }
}
