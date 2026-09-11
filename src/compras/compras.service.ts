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
    if (dto.produtoId) {
      const produto = await this.prisma.produto.findUnique({ where: { id: dto.produtoId } });
      if (!produto || produto.empresaId !== empresaId) {
        throw new NotFoundException(`Produto ${dto.produtoId} não encontrado.`);
      }
    }
    // Grade por tamanho (compra de produto com tamanhos): limpa e, se houver, a
    // quantidade passa a ser a SOMA da grade (fonte única da verdade).
    let grade: Prisma.InputJsonValue | undefined;
    let quantidade = dto.quantidade;
    if (dto.grade && typeof dto.grade === 'object') {
      const limpo: Record<string, number> = {};
      let soma = 0;
      for (const [t, q] of Object.entries(dto.grade)) { const n = Math.round(Number(q)); if (t && n > 0) { limpo[String(t).toUpperCase()] = n; soma += n; } }
      if (soma > 0) { grade = limpo as Prisma.InputJsonValue; quantidade = soma; }
    }

    const numero = await this.gerarNumero();
    return this.prisma.ordemCompra.create({
      data: {
        numero,
        fornecedorId: dto.fornecedorId,
        filialId: dto.filialId,
        materialId: dto.materialId,
        produtoId: dto.produtoId,
        grade,
        codigoFornecedor: dto.codigoFornecedor?.trim() || null,
        descricaoFornecedor: dto.descricaoFornecedor?.trim() || null,
        descricao: dto.descricao,
        quantidade,
        unidade: dto.unidade,
        valor: dto.valor,
        status: 'aguardando',
        previsao: dto.previsao ? new Date(dto.previsao) : undefined,
        motivo: dto.motivo,
      },
    });
  }

  /** Recebe a OC: baixa (status recebida) e repõe o saldo do material vinculado.
   *  `force`=true pula a trava de duplicidade (entrada de NF recente do material). */
  async receber(id: number, empresaId: number, force = false): Promise<OrdemCompra> {
    const oc = await this.findOne(id, empresaId);
    if (oc.status !== 'aguardando') {
      throw new ConflictException(`OC ${oc.numero} não está aguardando (status: ${oc.status}).`);
    }

    // TRAVA anti-duplicidade: se este material já teve entrada por NF recente (45 dias,
    // com estoque lançado), receber aqui somaria estoque de novo. Bloqueia até confirmar
    // (force). O caminho correto é dar entrada pela NF, que já baixa a OC automaticamente.
    if (!force && oc.materialId) {
      const dias45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      const nf = await this.prisma.notaEntrada.findFirst({
        where: { empresaId, lancadaEstoque: true, criadoEm: { gte: dias45 }, itens: { some: { materialId: oc.materialId } } },
        orderBy: { id: 'desc' },
        select: { numero: true, criadoEm: true },
      });
      if (nf) {
        throw new ConflictException({
          code: 'NF_DUP',
          numero: nf.numero,
          data: nf.criadoEm.toISOString().slice(0, 10),
          message: `Este material já teve entrada pela NF ${nf.numero} (${nf.criadoEm.toISOString().slice(0, 10)}) — o estoque já foi lançado. Receber aqui vai DUPLICAR. Prefira dar entrada pela NF (que baixa a OC sozinha). Confirmar mesmo assim?`,
        });
      }
    }

    const [atualizada] = await this.prisma.$transaction([
      this.prisma.ordemCompra.update({ where: { id }, data: { status: 'recebida', situacao: 'recebido', recebidaEm: new Date() } }),
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
   * Ciclo de compra (Fase 2): avança a SITUAÇÃO da OC e marca as datas.
   *  enviada  → registra o envio ao fornecedor (e-mail/WhatsApp).
   *  comprado → fornecedor confirmou; informa o prazo de entrega (dias).
   *  pago     → inicia o lead time; previsão = hoje + prazoEntregaDias.
   */
  async definirSituacao(id: number, empresaId: number, situacao: string, prazoEntregaDias?: number): Promise<OrdemCompra> {
    const oc = await this.findOne(id, empresaId);
    const validas = ['enviada', 'comprado', 'pago', 'recebido', 'aguardando'];
    if (!validas.includes(situacao)) throw new ConflictException(`Situação inválida: ${situacao}.`);
    const data: Prisma.OrdemCompraUpdateInput = { situacao };
    const agora = new Date();
    if (situacao === 'enviada') data.enviadaEm = agora;
    if (situacao === 'comprado') {
      data.compradaEm = agora;
      if (prazoEntregaDias != null && prazoEntregaDias >= 0) data.prazoEntregaDias = Math.floor(prazoEntregaDias);
    }
    if (situacao === 'pago') {
      data.pagaEm = agora;
      const dias = prazoEntregaDias != null ? Math.floor(prazoEntregaDias) : (oc.prazoEntregaDias ?? null);
      if (dias != null && dias >= 0) { data.prazoEntregaDias = dias; const prev = new Date(agora); prev.setDate(prev.getDate() + dias); data.previsaoEntrega = prev; }
    }
    return this.prisma.ordemCompra.update({ where: { id }, data });
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

  /**
   * REPOSIÇÃO por ponto de estoque: lista os materiais com saldo ABAIXO do mínimo,
   * já descontando o que houver em OC aberta, e sugere a quantidade a comprar
   * (mínimo − saldo − emAberto). Só-leitura — o usuário revisa antes de gerar.
   */
  async sugestoesReposicao(empresaId: number) {
    const mats = await this.prisma.material.findMany({
      where: { empresaId },
      select: { id: true, codigo: true, descricao: true, unidade: true, saldo: true, minimo: true, custo: true, fornecedorId: true },
    });
    const deficit = mats.filter((m) => Number(m.minimo) > 0 && Number(m.saldo) < Number(m.minimo));
    if (!deficit.length) return { itens: [] };
    const ocs = await this.prisma.ordemCompra.findMany({
      where: { fornecedor: { empresaId }, status: 'aguardando', materialId: { in: deficit.map((m) => m.id) } },
      select: { materialId: true, quantidade: true },
    });
    const jaOc = new Map<number, number>();
    for (const o of ocs) if (o.materialId != null) jaOc.set(o.materialId, (jaOc.get(o.materialId) ?? 0) + Number(o.quantidade));
    const fornIds = [...new Set(deficit.map((m) => m.fornecedorId).filter((x): x is number => x != null))];
    const forns = fornIds.length ? await this.prisma.fornecedor.findMany({ where: { id: { in: fornIds } }, select: { id: true, nome: true, email: true } }) : [];
    const fmap = new Map(forns.map((f) => [f.id, f]));
    const itens = deficit.map((m) => {
      const saldo = Number(m.saldo), minimo = Number(m.minimo), aberto = jaOc.get(m.id) ?? 0;
      const sugerido = Math.max(0, Number((minimo - saldo - aberto).toFixed(3)));
      const f = m.fornecedorId ? fmap.get(m.fornecedorId) : null;
      return {
        materialId: m.id, codigo: m.codigo, descricao: m.descricao, unidade: m.unidade,
        saldo, minimo, custo: Number(m.custo), aberto, sugerido,
        valor: Number((Number(m.custo) * sugerido).toFixed(2)),
        fornecedorId: m.fornecedorId ?? null, fornecedorNome: f?.nome ?? null, fornecedorEmail: f?.email ?? null,
      };
    }).filter((x) => x.sugerido > 0);
    return { itens };
  }

  /** Gera as OCs de reposição selecionadas pelo usuário (uma por material). */
  async gerarReposicao(empresaId: number, itens: Array<{ materialId: number; quantidade: number; fornecedorId?: number }>) {
    if (!itens?.length) throw new BadRequestException('Nenhum item selecionado para reposição.');
    const fornPadrao = await this.prisma.fornecedor.findFirst({ where: { empresaId, nome: { contains: 'DEFINIR', mode: 'insensitive' } } });
    const criadas: Array<{ id: number; numero: string; material: string; quantidade: number; unidade: string; valor: number; fornecedorId: number; fornecedorEmail: string | null }> = [];
    for (const it of itens) {
      const material = await this.prisma.material.findUnique({ where: { id: it.materialId } });
      if (!material || material.empresaId !== empresaId) throw new NotFoundException(`Material ${it.materialId} não encontrado.`);
      const qtd = Number(it.quantidade);
      if (!(qtd > 0)) continue;
      let fornecedorId = it.fornecedorId ?? material.fornecedorId ?? fornPadrao?.id;
      if (!fornecedorId) throw new BadRequestException(`Material ${material.codigo} sem fornecedor — cadastre o fornecedor do material ou um "A DEFINIR".`);
      const f = await this.prisma.fornecedor.findUnique({ where: { id: fornecedorId }, select: { empresaId: true, email: true } });
      if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Fornecedor ${fornecedorId} não encontrado.`);
      const valorNum = Number((Number(material.custo) * qtd).toFixed(2));
      const numero = await this.gerarNumero();
      const oc = await this.prisma.ordemCompra.create({
        data: {
          numero, fornecedorId, materialId: material.id,
          descricao: `${material.descricao} (${material.codigo})`,
          quantidade: new Prisma.Decimal(qtd.toFixed(3)), unidade: material.unidade,
          valor: new Prisma.Decimal(valorNum.toFixed(2)),
          motivo: 'Reposição de estoque (abaixo do mínimo)',
        },
      });
      criadas.push({ id: oc.id, numero: oc.numero, material: material.codigo, quantidade: qtd, unidade: material.unidade, valor: valorNum, fornecedorId, fornecedorEmail: f.email ?? null });
    }
    return { criadas, total: criadas.length };
  }

  private async gerarNumero(): Promise<string> {
    const existentes = await this.prisma.ordemCompra.findMany({ select: { numero: true } });
    return proximoSequencial('OC', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }
}
