import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Expedicao, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpedicaoDto } from './dto/create-expedicao.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

// bwip-js gera QR Code e código de barras (Code128) como PNG.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js') as { toBuffer: (opts: Record<string, unknown>) => Promise<Buffer> };

@Injectable()
export class ExpedicoesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados da etiqueta de expedição (preenchida do pedido) + QR e código de barras. */
  async etiqueta(id: number, empresaId: number) {
    const exp = await this.prisma.expedicao.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Expedição ${id} não encontrada.`);
    const pedido = exp.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true, filial: true } })
      : null;
    const prodIds = (pedido?.itens ?? []).map((i) => i.produtoId).filter((x): x is number => !!x);
    const produtos = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true } }) : [];
    const codMap = new Map(produtos.map((p) => [p.id, p.codigo]));
    const itens = (pedido?.itens ?? []).map((i) => {
      const g = i.grade as Record<string, number> | null;
      const grade = g && Object.keys(g).length ? Object.entries(g).map(([t, q]) => `${t}: ${q}`).join('   ') : '—';
      return { codigo: i.produtoId ? codMap.get(i.produtoId) ?? '—' : '—', descricao: i.descricao, grade, quantidade: i.quantidade };
    });
    const totalPecas = itens.reduce((s, i) => s + i.quantidade, 0) || exp.pecas;
    const codBip = String(exp.numero).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const emp = pedido?.filial;
    const [qr, barcode] = await Promise.all([
      bwipjs.toBuffer({ bcid: 'qrcode', text: codBip, scale: 4, padding: 0 }),
      bwipjs.toBuffer({ bcid: 'code128', text: codBip, scale: 2, height: 14, includetext: false, padding: 0 }),
    ]);
    return {
      empresa: emp ? { nome: emp.nome, cnpj: emp.cnpj } : { nome: 'GRUPO CHERKESIAN', cnpj: null },
      numero: exp.numero,
      pedido: pedido?.numero ?? '—',
      data: new Date().toISOString(),
      codBip,
      destino: {
        nome: cliente.nome,
        endereco: cliente.logradouro ?? '—',
        cidadeUf: cliente.cidadeUf ?? (cliente.municipio && cliente.uf ? `${cliente.municipio}/${cliente.uf}` : '—'),
        cep: cliente.cep ?? '—',
        cnpj: cliente.cnpjCpf ?? '—',
      },
      lote: exp.loteId ? String(exp.loteId) : null,
      volumes: exp.volumes,
      itens,
      totalPecas,
      qr: 'data:image/png;base64,' + qr.toString('base64'),
      barcode: 'data:image/png;base64,' + barcode.toString('base64'),
    };
  }

  async findAll(empresaId: number): Promise<Expedicao[]> {
    const clienteIds = await this.clienteIdsDaEmpresa(empresaId);
    return this.prisma.expedicao.findMany({
      where: { clienteId: { in: clienteIds } },
      orderBy: { id: 'desc' },
    });
  }

  async create(dto: CreateExpedicaoDto, empresaId: number): Promise<Expedicao> {
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

    // Se houver lote, consome (baixa lote + estoque) atomicamente com a expedição.
    if (dto.loteId) {
      const lote = await this.prisma.lote.findUnique({
        where: { id: dto.loteId },
        include: { estoque: { include: { produto: { select: { empresaId: true } } } } },
      });
      if (!lote || lote.estoque.produto.empresaId !== empresaId) {
        throw new NotFoundException(`Lote ${dto.loteId} não encontrado.`);
      }
      if (lote.quantidade < dto.pecas) {
        throw new BadRequestException(
          `Lote ${lote.codigoLote} tem apenas ${lote.quantidade} peças (pedido: ${dto.pecas}).`,
        );
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.lote.update({
          where: { id: lote.id },
          data: { quantidade: { decrement: dto.pecas } },
        });
        await tx.estoque.update({
          where: { id: lote.estoqueId },
          data: { saidas: { increment: dto.pecas } },
        });
        return tx.expedicao.create({ data: await this.montarDados(dto, tx) });
      });
    }

    return this.prisma.expedicao.create({ data: await this.montarDados(dto, this.prisma) });
  }

  /**
   * Gera a expedição DIRETO do pedido (revenda/faturamento sem produção): pula
   * a OP, cria a expedição com as peças do pedido e avança a etapa p/ expedição.
   * Depois é só emitir a NF a partir dessa expedição.
   */
  async criarDoPedido(pedidoId: number, empresaId: number): Promise<Expedicao> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { itens: true, cliente: true },
    });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    if (pedido.etapa === 'orcamento') throw new BadRequestException('Aprove o pedido antes de gerar a expedição.');
    if (pedido.etapa === 'expedicao') throw new ConflictException('Pedido já está em expedição.');
    const ja = await this.prisma.expedicao.findFirst({ where: { pedidoId } });
    if (ja) throw new ConflictException(`Pedido já possui a expedição ${ja.numero}.`);

    const pecas = pedido.itens.reduce((s, i) => s + i.quantidade, 0) || 1;
    const c = pedido.cliente;
    const cidadeUf = c.cidadeUf ?? (c.municipio && c.uf ? `${c.municipio}/${c.uf}` : undefined);
    return this.prisma.$transaction(async (tx) => {
      const numero = await this.gerarNumero(tx);
      const exp = await tx.expedicao.create({
        data: {
          numero,
          pedidoId,
          clienteId: pedido.clienteId,
          pecas,
          endereco: c.logradouro ?? undefined,
          cidadeUf,
          cep: c.cep ?? undefined,
          volumes: 1,
          rastreio: this.gerarRastreio(),
          status: 'Separado',
        },
      });
      await tx.pedido.update({ where: { id: pedidoId }, data: { etapa: 'expedicao', status: 'Expedição' } });
      return exp;
    });
  }

  private async montarDados(
    dto: CreateExpedicaoDto,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<Prisma.ExpedicaoCreateInput> {
    const numero = await this.gerarNumero(client);
    return {
      numero,
      pedidoId: dto.pedidoId,
      clienteId: dto.clienteId,
      loteId: dto.loteId,
      pecas: dto.pecas,
      endereco: dto.endereco,
      cidadeUf: dto.cidadeUf,
      cep: dto.cep,
      nf: dto.nf,
      transportadora: dto.transportadora,
      volumes: dto.volumes ?? 1,
      rastreio: this.gerarRastreio(),
      status: 'Separado',
    };
  }

  private async clienteIdsDaEmpresa(empresaId: number): Promise<number[]> {
    const clientes = await this.prisma.cliente.findMany({
      where: { empresaId },
      select: { id: true },
    });
    return clientes.map((c) => c.id);
  }

  private async gerarNumero(client: Prisma.TransactionClient | PrismaService): Promise<string> {
    const existentes = await client.expedicao.findMany({ select: { numero: true } });
    return proximoSequencial('EXP', existentes.map((e) => e.numero), { pad: 4, separador: '-' });
  }

  /** Rastreio simples baseado no tempo (placeholder até integração com transportadora). */
  private gerarRastreio(): string {
    return `BR${Date.now().toString(36).toUpperCase()}CK`;
  }
}
