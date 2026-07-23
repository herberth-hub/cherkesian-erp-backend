import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OP } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateOpProgressoDto, UpdateOpStatusDto } from './dto/update-op.dto';

@Injectable()
export class OpsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number) {
    return this.prisma.oP.findMany({
      where: { pedido: { empresaId } },
      include: { pedido: { select: { numero: true, clienteId: true } } },
      orderBy: [{ prioridade: 'asc' }, { id: 'desc' }],
    });
  }

  async findOne(id: number, empresaId: number): Promise<OP> {
    const op = await this.prisma.oP.findUnique({
      where: { id },
      include: { pedido: { select: { empresaId: true } }, lotes: true },
    });
    if (!op || op.pedido?.empresaId !== empresaId) {
      throw new NotFoundException(`OP ${id} não encontrada.`);
    }
    return op;
  }

  async updateStatus(id: number, dto: UpdateOpStatusDto, empresaId: number): Promise<OP> {
    await this.findOne(id, empresaId);
    const data: Record<string, unknown> = {
      status: dto.status,
      setorAtual: dto.setorAtual,
      responsavel: dto.responsavel,
    };
    // Ajustes automáticos de acordo com o status
    if (dto.status === 'em_producao' || dto.status === 'em_corte') {
      const op = await this.prisma.oP.findUnique({ where: { id }, select: { inicio: true } });
      if (op && !op.inicio) data.inicio = new Date();
    }
    if (dto.status === 'concluido') {
      data.progresso = 100;
    }
    return this.prisma.oP.update({ where: { id }, data });
  }

  /** Define a grade de tamanhos da OP, ex.: {"P":10,"M":20,"G":8}. {} limpa. */
  async updateGrade(id: number, grade: Record<string, unknown>, empresaId: number): Promise<OP> {
    const op = await this.findOne(id, empresaId);
    const limpa: Record<string, number> = {};
    let total = 0;
    for (const [tamanho, qtd] of Object.entries(grade ?? {})) {
      const t = String(tamanho).trim().toUpperCase();
      const n = Number(qtd);
      if (!t || t.length > 6) throw new BadRequestException(`Tamanho inválido: "${tamanho}".`);
      if (!Number.isInteger(n) || n < 0) {
        throw new BadRequestException(`Quantidade inválida para ${t}: "${qtd}".`);
      }
      if (n > 0) { limpa[t] = n; total += n; }
    }
    if (total > 0 && total !== op.quantidade) {
      throw new BadRequestException(
        `A grade soma ${total} peças, mas a OP tem ${op.quantidade}. Ajuste as quantidades.`,
      );
    }
    return this.prisma.oP.update({
      where: { id },
      data: { gradeTamanhos: total > 0 ? limpa : undefined },
    });
  }

  async updateProgresso(id: number, dto: UpdateOpProgressoDto, empresaId: number): Promise<OP> {
    await this.findOne(id, empresaId);
    return this.prisma.oP.update({
      where: { id },
      data: { progresso: dto.progresso },
    });
  }

  /**
   * Etiqueta do fardo (corte) para impressão na Zebra. Monta os dados e o ZPL
   * com código de barras da OP — o cortador cola no fardo em vez de escrever.
   */
  async etiqueta(id: number, empresaId: number, destino?: string) {
    const op = await this.prisma.oP.findUnique({
      where: { id },
      include: {
        pedido: { select: { empresaId: true, numero: true, obs: true, cliente: { select: { nome: true } } } },
      },
    });
    if (!op || op.pedido?.empresaId !== empresaId) throw new NotFoundException(`OP ${id} não encontrada.`);
    const produto = op.produtoId
      ? await this.prisma.produto.findUnique({ where: { id: op.produtoId }, select: { codigo: true, descricao: true } })
      : null;

    const grade = (op.gradeTamanhos as Record<string, number> | null) ?? {};
    const gradeTxt = Object.keys(grade).length
      ? Object.entries(grade).map(([t, q]) => `${t}=${q}`).join('  ')
      : '-';
    // Cor: não é campo estruturado — tenta extrair da observação do pedido ("Cor: X").
    const corMatch = /cor\s*:\s*([^·|\n]+)/i.exec(op.pedido?.obs ?? '');
    const cor = corMatch ? corMatch[1].trim() : '-';
    const dados = {
      op: op.numero,
      pedido: op.pedido?.numero ?? '-',
      cliente: op.pedido?.cliente?.nome ?? '-',
      produto: produto ? `${produto.codigo} · ${produto.descricao}` : '-',
      quantidade: op.quantidade,
      grade: gradeTxt,
      cor,
      destino: destino?.trim() || op.setorAtual || '-',
    };
    return { dados, zpl: this.montarZpl(dados) };
  }

  /** ZPL para etiqueta ~100x80mm @203dpi (Code128 da OP). */
  private montarZpl(d: { op: string; pedido: string; cliente: string; produto: string; quantidade: number; grade: string; cor: string; destino: string }): string {
    const s = (v: string | number) => String(v).replace(/[\^~]/g, ' ').slice(0, 40);
    return [
      '^XA',
      '^CI28', // UTF-8
      '^CF0,34',
      `^FO24,24^FDGRUPO CHERKESIAN^FS`,
      '^CF0,28',
      `^FO24,70^FDOP: ${s(d.op)}   PED: ${s(d.pedido)}^FS`,
      `^FO24,108^FDCliente: ${s(d.cliente)}^FS`,
      `^FO24,146^FDProduto: ${s(d.produto)}^FS`,
      `^FO24,184^FDGrade: ${s(d.grade)}^FS`,
      `^FO24,222^FDQtd total: ${d.quantidade}   Cor: ${s(d.cor)}^FS`,
      '^CF0,32',
      `^FO24,264^FDDESTINO: ${s(d.destino)}^FS`,
      `^FO24,320^BY3^BCN,120,Y,N,N^FD${s(d.op)}^FS`,
      '^XZ',
    ].join('\n');
  }
}
