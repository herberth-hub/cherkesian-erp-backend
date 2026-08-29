import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Produto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { CreditoService } from '../credito/credito.service';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class PedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credito: CreditoService,
  ) {}

  async findAll(empresaId: number, scope?: { vendedorId: number; usuario: string }) {
    // Escopo do vendedor: só os pedidos dele (vendedorId) ou criados por ele (legado).
    const where: Prisma.PedidoWhereInput = scope
      ? { empresaId, OR: [{ vendedorId: scope.vendedorId }, { criadoPor: scope.usuario }] }
      : { empresaId };
    const pedidos = await this.prisma.pedido.findMany({
      where,
      include: {
        itens: true,
        cliente: { select: { id: true, nome: true } },
        filial: { select: { id: true, nome: true, matriz: true } },
        ops: { select: { numero: true, status: true } },
      },
      orderBy: { id: 'desc' },
    });

    // NF-e vinculadas ao pedido (nº + status) para exibir na lista.
    const notas = await this.prisma.notaFiscal.findMany({
      where: { empresaId, pedidoId: { not: null } },
      select: { pedidoId: true, numero: true, status: true },
      orderBy: { id: 'asc' },
    });
    const nfPorPedido = new Map<number, { numero: string; status: string }[]>();
    for (const n of notas) {
      const arr = nfPorPedido.get(n.pedidoId as number) ?? [];
      arr.push({ numero: n.numero, status: n.status });
      nfPorPedido.set(n.pedidoId as number, arr);
    }

    // Ordens de compra geradas pela automação (referência ao pedido no motivo).
    const ocs = await this.prisma.ordemCompra.findMany({
      where: { fornecedor: { empresaId } },
      select: { numero: true, motivo: true },
    });

    // Unidade/filial do cliente (destinatário) para exibir na lista, ao lado do cliente.
    const uniIds = [...new Set(pedidos.map((p) => p.clienteUnidadeId).filter((x): x is number => x != null))];
    const unidades = uniIds.length
      ? await this.prisma.clienteUnidade.findMany({ where: { id: { in: uniIds } }, select: { id: true, nome: true, cnpjCpf: true } })
      : [];
    const uniMap = new Map(unidades.map((u) => [u.id, u]));

    return pedidos.map((p) => {
      const uni = p.clienteUnidadeId != null ? uniMap.get(p.clienteUnidadeId) : null;
      return {
        ...p,
        unidadeNome: uni?.nome ?? null,
        unidadeCnpj: uni?.cnpjCpf ?? null,
        nfs: nfPorPedido.get(p.id) ?? [],
        opsNumeros: p.ops.map((o) => o.numero),
        ocsNumeros: ocs.filter((o) => (o.motivo ?? '').includes(p.numero)).map((o) => o.numero),
      };
    });
  }

  async findOne(id: number, empresaId: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        itens: true,
        cliente: { select: { id: true, nome: true } },
        pilotos: true,
        ops: true,
      },
    });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${id} não encontrado.`);
    }
    return pedido;
  }

  /** Cria orçamento/pedido. Cliente novo ⇒ exigePiloto (trava a produção depois). */
  async create(dto: CreatePedidoDto, empresaId: number, criadoPor: string, vendedorId?: number) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }

    // Crédito: consulta na criação do pedido; restrição bloqueia (admin libera).
    const credito = await this.credito.avaliarParaPedido(dto.clienteId, empresaId, criadoPor);
    if (!credito.permitido) throw new ConflictException(credito.motivo);

    // Resolve itens (valida produto, herda descrição) e soma o total.
    let valorTotal = new Prisma.Decimal(0);
    const itensData: Prisma.PedidoItemCreateWithoutPedidoInput[] = [];
    for (const item of dto.itens) {
      let descricao = item.descricao;
      let produto: Produto | null = null;
      if (item.produtoId) {
        produto = await this.prisma.produto.findUnique({ where: { id: item.produtoId } });
        if (!produto || produto.empresaId !== empresaId) {
          throw new NotFoundException(`Produto ${item.produtoId} não encontrado.`);
        }
        descricao = descricao ?? produto.descricao;
      }
      if (!descricao) {
        throw new BadRequestException('Cada item precisa de descrição ou de um produtoId válido.');
      }
      const valorUnit = new Prisma.Decimal(item.valorUnit);
      const { grade, quantidade } = this.normalizarGrade(item);
      valorTotal = valorTotal.plus(this.subtotalItem(produto, valorUnit, grade, quantidade));
      itensData.push({
        produtoId: item.produtoId,
        descricao,
        cor: item.cor?.trim() || null,
        quantidade,
        valorUnit,
        grade,
      });
    }

    const numero = await this.gerarNumeroPedido(empresaId);
    const filialId = await this.resolverFilial(empresaId, dto.filialId);

    const pedido = await this.prisma.pedido.create({
      data: {
        empresaId,
        numero,
        clienteId: dto.clienteId,
        clienteUnidadeId: dto.clienteUnidadeId ?? null,
        filialId,
        valorTotal,
        bonificacao: dto.bonificacao ?? false,
        status: 'Orçamento',
        etapa: 'orcamento',
        clienteNovo: cliente.clienteNovo,
        prazoEntrega: dto.prazoEntrega ? new Date(dto.prazoEntrega) : undefined,
        formaPagamento: dto.formaPagamento,
        frete: dto.frete,
        valorFrete: dto.valorFrete ?? 0,
        ordemCompraCliente: dto.ordemCompraCliente,
        obs: dto.obs,
        obsComercial: dto.obsComercial,
        criadoPor,
        vendedorId: vendedorId ?? null,
        itens: { create: itensData },
      },
      include: { itens: true },
    });

    return { ...pedido, exigePiloto: pedido.clienteNovo };
  }

  /**
   * Edita/RETIFICA um pedido. Em orçamento/aprovado/piloto substitui os itens.
   * Se o pedido JÁ tem produção/expedição, faz uma retificação SEGURA: preserva o
   * que já foi expedido (não reduz abaixo do enviado nem remove item já expedido).
   * Nunca edita com NF ativa — cancele a NF antes.
   */
  async update(id: number, dto: CreatePedidoDto, empresaId: number) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id }, include: { ops: true, itens: true } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${id} não encontrado.`);
    const nfAtiva = await this.prisma.notaFiscal.findFirst({ where: { pedidoId: id, status: { in: ['autorizada', 'pendente'] } } });
    if (nfAtiva) throw new ConflictException(`Não é possível retificar: existe a nota fiscal ${nfAtiva.numero} ATIVA. Cancele a NF antes de editar.`);

    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);

    // Recalcula itens e total (mesma validação da criação).
    let valorTotal = new Prisma.Decimal(0);
    const novos: Array<{ produtoId: number | null; descricao: string; cor: string | null; quantidade: number; valorUnit: Prisma.Decimal; grade: Prisma.InputJsonValue | null }> = [];
    for (const item of dto.itens) {
      let descricao = item.descricao;
      let produto: Produto | null = null;
      if (item.produtoId) {
        produto = await this.prisma.produto.findUnique({ where: { id: item.produtoId } });
        if (!produto || produto.empresaId !== empresaId) throw new NotFoundException(`Produto ${item.produtoId} não encontrado.`);
        descricao = descricao ?? produto.descricao;
      }
      if (!descricao) throw new BadRequestException('Cada item precisa de descrição ou de um produtoId válido.');
      const valorUnit = new Prisma.Decimal(item.valorUnit);
      const { grade, quantidade } = this.normalizarGrade(item);
      valorTotal = valorTotal.plus(this.subtotalItem(produto, valorUnit, grade, quantidade));
      novos.push({ produtoId: item.produtoId ?? null, descricao, cor: item.cor?.trim() || null, quantidade, valorUnit, grade: (grade ?? null) as Prisma.InputJsonValue | null });
    }

    const filialId = await this.resolverFilial(empresaId, dto.filialId);
    const dadosPedido = {
      clienteId: dto.clienteId,
      clienteUnidadeId: dto.clienteUnidadeId ?? null,
      filialId,
      valorTotal,
      bonificacao: dto.bonificacao ?? false,
      clienteNovo: cliente.clienteNovo,
      prazoEntrega: dto.prazoEntrega ? new Date(dto.prazoEntrega) : null,
      formaPagamento: dto.formaPagamento,
      frete: dto.frete,
      valorFrete: dto.valorFrete,
      ordemCompraCliente: dto.ordemCompraCliente,
      obs: dto.obs,
      obsComercial: dto.obsComercial,
    };

    const temExpedido = pedido.itens.some((i) => (i.quantidadeExpedida ?? 0) > 0);
    const emProducao = pedido.ops.length > 0 || ['material', 'compra', 'producao', 'estoque', 'expedicao', 'parcial', 'concluido'].includes(pedido.etapa);

    // Caminho simples: sem produção/expedição → substitui os itens (orçamento/aprovado/piloto).
    if (!temExpedido && !emProducao) {
      return this.prisma.$transaction(async (tx) => {
        await tx.pedidoItem.deleteMany({ where: { pedidoId: id } });
        return tx.pedido.update({ where: { id }, data: { ...dadosPedido, itens: { create: novos.map((n) => ({ produtoId: n.produtoId ?? undefined, descricao: n.descricao, cor: n.cor, quantidade: n.quantidade, valorUnit: n.valorUnit, grade: n.grade ?? Prisma.JsonNull })) } }, include: { itens: true } });
      });
    }

    // ===== RETIFICAÇÃO SEGURA (pedido já em produção/expedido) =====
    // Chave inclui o PREÇO: um mesmo produto+cor pode ter DUAS linhas (preço base
    // dos tamanhos normais e preço especial dos tamanhos grandes) — sem o preço na
    // chave as duas colidiriam e uma linha (ex.: os tamanhos P) seria perdida.
    const norm = (s?: string | null) => String(s ?? '').trim().toUpperCase();
    const preco = (v: Prisma.Decimal) => Number(v).toFixed(2);
    const chave = (produtoId: number | null, cor: string | null, valorUnit: Prisma.Decimal) => `${produtoId ?? 0}|${norm(cor)}|${preco(valorUnit)}`;
    const porChave = new Map(pedido.itens.map((i) => [chave(i.produtoId, i.cor, i.valorUnit), i]));
    const usados = new Set<number>();
    return this.prisma.$transaction(async (tx) => {
      for (const nv of novos) {
        const ex = porChave.get(chave(nv.produtoId, nv.cor, nv.valorUnit));
        if (ex) {
          usados.add(ex.id);
          const jaExp = ex.quantidadeExpedida ?? 0;
          if (nv.quantidade < jaExp) throw new ConflictException(`"${nv.descricao}": não pode reduzir para ${nv.quantidade} — já foram expedidas ${jaExp} peça(s).`);
          const gExp = (ex.gradeExpedida as Record<string, number> | null) ?? {};
          if (nv.grade && typeof nv.grade === 'object') {
            for (const [t, q] of Object.entries(gExp)) {
              if (Number((nv.grade as Record<string, number>)[t] ?? 0) < Number(q)) throw new ConflictException(`"${nv.descricao}" TAM ${t}: não pode ficar abaixo do já expedido (${q}).`);
            }
          }
          await tx.pedidoItem.update({ where: { id: ex.id }, data: { descricao: nv.descricao, valorUnit: nv.valorUnit, quantidade: nv.quantidade, grade: nv.grade ?? Prisma.JsonNull } });
        } else {
          await tx.pedidoItem.create({ data: { pedidoId: id, produtoId: nv.produtoId ?? undefined, descricao: nv.descricao, cor: nv.cor, quantidade: nv.quantidade, valorUnit: nv.valorUnit, grade: nv.grade ?? Prisma.JsonNull } });
        }
      }
      // Remoções: só itens que NÃO foram expedidos.
      for (const ex of pedido.itens) {
        if (usados.has(ex.id)) continue;
        if ((ex.quantidadeExpedida ?? 0) > 0) throw new ConflictException(`Não é possível remover "${ex.descricao}" — já tem ${ex.quantidadeExpedida} peça(s) expedida(s).`);
        await tx.pedidoItem.delete({ where: { id: ex.id } });
      }
      // ===== SINCRONIZA as OPs com o pedido retificado (evita erro de produção) =====
      const { opsSincronizadas, opsAviso } = await this.sincronizarOps(tx, pedido.ops, novos, norm);

      // Reavalia a etapa pela expedição real dos itens finais.
      const finais = await tx.pedidoItem.findMany({ where: { pedidoId: id } });
      const tot = finais.reduce((s, i) => s + i.quantidade, 0);
      const exp = finais.reduce((s, i) => s + (i.quantidadeExpedida ?? 0), 0);
      const etapaNova = exp <= 0 ? pedido.etapa : exp >= tot ? 'concluido' : 'parcial';
      const statusNovo = exp <= 0 ? pedido.status : exp >= tot ? 'Concluído' : 'Expedição parcial';
      const atualizado = await tx.pedido.update({ where: { id }, data: { ...dadosPedido, etapa: etapaNova, status: statusNovo }, include: { itens: true } });
      return { ...atualizado, opsSincronizadas, opsAviso };
    });
  }

  /** Exclui um pedido que ainda não gerou OP nem NF. */
  async remove(id: number, empresaId: number) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id }, include: { ops: true } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${id} não encontrado.`);
    if (pedido.ops.length > 0) throw new ConflictException('Pedido já tem Ordem de Produção — não pode ser excluído.');
    const nf = await this.prisma.notaFiscal.findFirst({ where: { pedidoId: id, status: { in: ['autorizada', 'pendente'] } } });
    if (nf) throw new ConflictException(`Pedido vinculado à nota fiscal ativa ${nf.numero} — cancele a NF antes de excluir.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.contaReceber.deleteMany({ where: { pedidoId: id } });
      await tx.pedidoItem.deleteMany({ where: { pedidoId: id } });
      await tx.pedido.delete({ where: { id } });
    });
    return { removido: true, id, numero: pedido.numero };
  }

  /**
   * Sincroniza as OPs com o pedido retificado: ajusta quantidade + grade por tamanho
   * de cada OP ao novo item (produto+cor). NUNCA reduz abaixo do que já foi cortado;
   * flags para casos ambíguos (várias OPs, item removido, OP concluída). Escala o
   * romaneio de materiais proporcional à nova quantidade.
   */
  private async sincronizarOps(
    tx: Prisma.TransactionClient,
    ops: Array<{ id: number; numero: string; produtoId: number | null; cor: string | null; quantidade: number; quantidadeCortada: number | null; gradeCortada: unknown; romaneioMateriais: unknown; status: string }>,
    novos: Array<{ produtoId: number | null; cor: string | null; quantidade: number; grade: Prisma.InputJsonValue | null }>,
    norm: (s?: string | null) => string,
  ): Promise<{ opsSincronizadas: string[]; opsAviso: string[] }> {
    const opsSincronizadas: string[] = [];
    const opsAviso: string[] = [];
    if (!ops.length) return { opsSincronizadas, opsAviso };

    // Agrega os itens novos por produto+cor (base+especial do mesmo produto/cor somam).
    const agg = new Map<string, { qty: number; grade: Record<string, number> }>();
    for (const nv of novos) {
      const k = `${nv.produtoId ?? 0}|${norm(nv.cor)}`;
      const cur = agg.get(k) ?? { qty: 0, grade: {} };
      cur.qty += nv.quantidade;
      if (nv.grade && typeof nv.grade === 'object') for (const [t, q] of Object.entries(nv.grade as Record<string, number>)) cur.grade[norm(t)] = (cur.grade[norm(t)] ?? 0) + Number(q);
      agg.set(k, cur);
    }
    // Agrupa OPs por produto+cor.
    const opsPorChave = new Map<string, typeof ops>();
    for (const op of ops) { const k = `${op.produtoId ?? 0}|${norm(op.cor)}`; const a = opsPorChave.get(k) ?? []; a.push(op); opsPorChave.set(k, a); }

    for (const [k, lista] of opsPorChave) {
      const alvo = agg.get(k);
      if (lista.length > 1) { opsAviso.push(`${lista.map((o) => o.numero).join('/')}: mais de uma OP p/ o mesmo produto/cor — ajuste manual.`); continue; }
      const op = lista[0];
      const cortado = Number(op.quantidadeCortada ?? 0);
      const gradeCort = (op.gradeCortada as Record<string, number> | null) ?? {};
      if (!alvo || alvo.qty <= 0) {
        opsAviso.push(`${op.numero}: item removido/zerado no pedido — revise ou cancele a OP (${op.quantidade} pç).`);
        await tx.oP.update({ where: { id: op.id }, data: { corteObs: '⚠ Item removido/zerado na retificação do pedido. Revise ou cancele esta OP.' } });
        continue;
      }
      if (op.status === 'concluido') { if (alvo.qty !== op.quantidade) opsAviso.push(`${op.numero}: já concluída, mas o pedido mudou p/ ${alvo.qty} pç — revise.`); continue; }
      if (alvo.qty < cortado) { opsAviso.push(`${op.numero}: nova qtd ${alvo.qty} < já cortado ${cortado} — mantive o corte.`); continue; }

      // Grade nova: nunca abaixo do já cortado por tamanho.
      const novaGrade: Record<string, number> | undefined = Object.keys(alvo.grade).length ? { ...alvo.grade } : undefined;
      if (novaGrade) for (const [t, qc] of Object.entries(gradeCort)) { const tn = norm(t); if ((novaGrade[tn] ?? 0) < Number(qc)) novaGrade[tn] = Number(qc); }
      const novaQtd = Math.max(alvo.qty, cortado);

      // Escala o romaneio de materiais proporcional à nova quantidade.
      let romaneio = op.romaneioMateriais as Array<{ quantidade: number; [x: string]: unknown }> | null;
      if (romaneio && Array.isArray(romaneio) && op.quantidade > 0 && novaQtd !== op.quantidade) {
        const ratio = novaQtd / op.quantidade;
        romaneio = romaneio.map((r) => ({ ...r, quantidade: Number((Number(r.quantidade) * ratio).toFixed(4)) }));
      }

      await tx.oP.update({
        where: { id: op.id },
        data: {
          quantidade: novaQtd,
          gradeTamanhos: (novaGrade as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          ...(romaneio ? { romaneioMateriais: romaneio as Prisma.InputJsonValue } : {}),
          corteObs: `Grade/quantidade sincronizada com a retificação do pedido (${new Date().toISOString().slice(0, 10)}).`,
        },
      });
      opsSincronizadas.push(op.numero);
    }
    return { opsSincronizadas, opsAviso };
  }

  /**
   * CANCELA o pedido (mantém o registro, marca etapa=cancelado). Diferente de excluir.
   * Não permite se houver NF ativa (autorizada/pendente) — cancele a NF antes.
   */
  async cancelar(id: number, empresaId: number) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${id} não encontrado.`);
    if (pedido.etapa === 'cancelado') return { ...pedido, jaCancelado: true };
    const nf = await this.prisma.notaFiscal.findFirst({ where: { pedidoId: id, status: { in: ['autorizada', 'pendente'] } } });
    if (nf) throw new ConflictException(`Pedido vinculado à nota fiscal ativa ${nf.numero} — cancele a NF antes de cancelar o pedido.`);
    return this.prisma.pedido.update({ where: { id }, data: { etapa: 'cancelado', status: 'Cancelado' } });
  }

  /** Aprova o orçamento: vira pedido e avança a etapa (piloto se cliente novo). */
  async aprovar(id: number, empresaId: number) {
    const pedido = await this.findOne(id, empresaId);
    if (pedido.etapa !== 'orcamento') {
      throw new ConflictException(
        `Pedido ${pedido.numero} já foi aprovado (etapa atual: ${pedido.etapa}).`,
      );
    }
    const proximaEtapa = pedido.clienteNovo ? 'piloto' : 'aprovado';
    return this.prisma.pedido.update({
      where: { id },
      data: { etapa: proximaEtapa, status: 'Aprovado' },
      include: { itens: true },
    });
  }

  /**
   * CORAÇÃO DO ERP — Gera a Ordem de Produção para um pedido:
   *  1. cliente novo exige peça-piloto liberada (senão bloqueia);
   *  2. calcula o consumo (BOM × quantidade) de cada material;
   *  3. compara com Material.saldo; se faltar, cria OrdemCompra (aguardando) e bloqueia;
   *  4. com material disponível, gera a OP, baixa o saldo e avança o pedido p/ produção.
   * Tudo numa transação.
   */
  async gerarOp(id: number, empresaId: number, parcial = false) {
    const pedido = await this.findOne(id, empresaId);

    // Pré-condições de estado
    if (pedido.etapa === 'orcamento') {
      throw new BadRequestException('Aprove o pedido antes de gerar a OP.');
    }
    // Já teve OP → bloqueia, EXCETO quando é produção parcial (falta a OP complementar).
    const emProducaoParcial = (pedido as { producaoParcial?: boolean }).producaoParcial === true;
    if ((['estoque', 'expedicao'].includes(pedido.etapa) || pedido.ops.length > 0) && !emProducaoParcial) {
      throw new ConflictException(`Pedido ${pedido.numero} já teve OP gerada.`);
    }

    // 0) Aviso: itens em TEXTO LIVRE (sem produto do catálogo) não têm ficha
    // técnica nem receita de material — não dá para gerar produção deles.
    const itensLivres = pedido.itens.filter((i) => !i.produtoId && i.quantidade > 0);
    if (itensLivres.length) {
      return {
        status: 'itens_livres' as const,
        pedido: { numero: pedido.numero, etapa: pedido.etapa },
        itens: itensLivres.map((i) => i.descricao),
        message:
          `Este pedido tem ${itensLivres.length} item(ns) em texto livre (sem produto do catálogo): ` +
          `${itensLivres.map((i) => `"${i.descricao}"`).join(', ')}. ` +
          'Edite o pedido e vincule cada um a um produto cadastrado antes de gerar a OP — ' +
          'assim a produção puxa a ficha técnica e baixa o material corretamente.',
      };
    }

    // 1) Piloto liberado (para cliente novo)
    if (pedido.clienteNovo) {
      const pilotoLiberado = pedido.pilotos.some((p) => p.liberado);
      if (!pilotoLiberado) {
        return {
          status: 'bloqueado_piloto' as const,
          pedido: { numero: pedido.numero, etapa: pedido.etapa },
          message:
            'Cliente novo: é necessária uma peça-piloto aprovada antes de gerar a OP.',
        };
      }
    }

    // 2) Separa itens de PRODUÇÃO (geram OP) dos de REVENDA (não geram OP).
    //    Item sem produtoId (sob medida) conta como produção.
    const prodIds = [...new Set(pedido.itens.map((i) => i.produtoId).filter((x): x is number => x != null))];
    const prods = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, tipo: true, componentes: true } }) : [];
    const tipoDe = new Map(prods.map((p) => [p.id, p.tipo]));
    const compDe = new Map(prods.map((p) => [p.id, p.componentes as { produtoId: number; quantidade: number }[] | null]));
    const ehProducao = (item: (typeof pedido.itens)[number]) => !item.produtoId || tipoDe.get(item.produtoId) !== 'revenda';
    const itensProducao = pedido.itens.filter(ehProducao);
    const itensRevenda = pedido.itens.filter((i) => !ehProducao(i));

    // Só revenda → não gera OP; pedido segue direto para expedição.
    if (itensProducao.length === 0) {
      await this.prisma.pedido.update({ where: { id }, data: { etapa: 'estoque', status: 'Pronto para expedição' } });
      return {
        status: 'sem_producao' as const,
        pedido: { numero: pedido.numero, etapa: 'estoque' },
        revenda: itensRevenda.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade })),
        message: 'Todos os itens são de revenda — nenhuma OP necessária. Pedido liberado para expedição.',
      };
    }

    // Expande conjuntos (produtos com componentes) em UNIDADES de produção — 1 OP por unidade.
    type UnidProd = { chave: number; produtoId: number | null; quantidade: number; grade: unknown; cor: string | null };
    let unidades: UnidProd[] = [];
    let ch = 0;
    for (const item of itensProducao) {
      const comps = item.produtoId ? compDe.get(item.produtoId) : null;
      const cor = (item as { cor?: string | null }).cor ?? null;
      if (comps && comps.length) {
        // Conjunto: cada componente tem a SUA cor (camiseta e calça podem diferir).
        // Deixa null p/ a OP herdar a cor do cadastro do próprio componente.
        for (const c of comps) unidades.push({ chave: ch++, produtoId: c.produtoId, quantidade: item.quantidade * (Number(c.quantidade) || 1), grade: item.grade, cor: null });
      } else {
        unidades.push({ chave: ch++, produtoId: item.produtoId ?? null, quantidade: item.quantidade, grade: item.grade, cor });
      }
    }

    // OP COMPLEMENTAR (produção parcial anterior): subtrai o que já foi produzido
    // por produto, deixando só o RESTANTE a produzir agora.
    if (emProducaoParcial && pedido.ops.length) {
      const jaProd = new Map<number, number>();
      for (const o of pedido.ops as { produtoId: number | null; quantidade: number }[]) {
        if (o.produtoId != null) jaProd.set(o.produtoId, (jaProd.get(o.produtoId) ?? 0) + o.quantidade);
      }
      for (const u of unidades) {
        if (u.produtoId == null) continue;
        const budget = jaProd.get(u.produtoId) ?? 0;
        if (budget <= 0) continue;
        const tira = Math.min(budget, u.quantidade);
        u.grade = this.escalarGrade(u.grade, u.quantidade > 0 ? (u.quantidade - tira) / u.quantidade : 0);
        u.quantidade -= tira;
        jaProd.set(u.produtoId, budget - tira);
      }
      unidades = unidades.filter((u) => u.quantidade > 0);
      if (!unidades.length) {
        await this.prisma.pedido.update({ where: { id }, data: { producaoParcial: false, etapa: 'producao', status: 'Em produção' } });
        return { status: 'sem_producao' as const, pedido: { numero: pedido.numero, etapa: 'producao' }, message: 'Todas as peças já foram produzidas nas OPs anteriores. Nada restante para produzir.' };
      }
    }

    // Consumo agregado (BOM × quantidade) por unidade de produção (romaneio por unidade).
    const necessarioPorMaterial = new Map<number, Prisma.Decimal>();
    const bomPorItem = new Map<number, Awaited<ReturnType<typeof this.prisma.consumo.findMany>>>();
    let totalPecas = 0;
    for (const u of unidades) {
      totalPecas += u.quantidade;
      if (!u.produtoId) continue;
      const bom = await this.prisma.consumo.findMany({ where: { produtoId: u.produtoId } });
      bomPorItem.set(u.chave, bom);
      for (const b of bom) {
        const usa = this.consumoDoItem(b, u);
        const atual = necessarioPorMaterial.get(b.materialId) ?? new Prisma.Decimal(0);
        necessarioPorMaterial.set(b.materialId, atual.plus(usa));
      }
    }

    // 3) Compara com o saldo dos materiais
    const materiais = await this.prisma.material.findMany({
      where: { id: { in: [...necessarioPorMaterial.keys()] } },
    });
    const faltantes: {
      material: (typeof materiais)[number];
      necessario: Prisma.Decimal;
      faltam: Prisma.Decimal;
    }[] = [];
    for (const material of materiais) {
      const necessario = necessarioPorMaterial.get(material.id)!;
      if (material.saldo.lessThan(necessario)) {
        faltantes.push({ material, necessario, faltam: necessario.minus(material.saldo) });
      }
    }

    // 3b) Faltou material → cria Ordem(ns) de Compra e bloqueia.
    //     IDEMPOTENTE: se o pedido já tem OC aberta (aguardando) para o mesmo
    //     material, NÃO cria outra — evita duplicidade ao reprocessar "Gerar OP"
    //     enquanto o pedido está em 'compra' esperando o material chegar.
    if (faltantes.length > 0) {
      const motivoPedido = `Reposição automática p/ pedido ${pedido.numero}`;

      // ===== PRODUÇÃO PARCIAL: CORTE MAIS RENTÁVEL — maximiza o nº de peças =====
      // Guloso: corta primeiro os tamanhos que gastam MENOS tecido por peça (rendem
      // mais unidades), respeitando a quantidade pedida de cada tamanho e o saldo.
      if (parcial) {
        type Grupo = { u: (typeof unidades)[number]; tam: string | null; pedido: number; consPorMat: Map<number, number> };
        const grupos: Grupo[] = [];
        for (const u of unidades) {
          const bom = bomPorItem.get(u.chave) ?? [];
          const grade = u.grade as Record<string, number> | null | undefined;
          if (grade && typeof grade === 'object' && Object.keys(grade).length) {
            for (const [t, q] of Object.entries(grade)) {
              const qn = Number(q) || 0; if (qn <= 0) continue;
              const cpm = new Map<number, number>();
              for (const b of bom) { const porTam = b.porTamanho as Record<string, number> | null | undefined; const c = Number((porTam && (porTam[t.toUpperCase()] ?? porTam[t])) ?? Number(b.quantidade)); if (c > 0) cpm.set(b.materialId, c); }
              grupos.push({ u, tam: t, pedido: qn, consPorMat: cpm });
            }
          } else {
            const cpm = new Map<number, number>();
            for (const b of bom) { const c = Number(b.quantidade); if (c > 0) cpm.set(b.materialId, c); }
            grupos.push({ u, tam: null, pedido: u.quantidade, consPorMat: cpm });
          }
        }
        // Ordena por consumo total por peça (asc): peça mais "barata" de tecido primeiro.
        grupos.sort((a, b) => [...a.consPorMat.values()].reduce((s, x) => s + x, 0) - [...b.consPorMat.values()].reduce((s, x) => s + x, 0));
        const remanescente = new Map<number, number>();
        const saldoDe = (mid: number) => { const m = materiais.find((x) => x.id === mid); return m ? Number(m.saldo) : 0; };
        for (const g of grupos) for (const mid of g.consPorMat.keys()) if (!remanescente.has(mid)) remanescente.set(mid, saldoDe(mid));
        const cortePorUnidade = new Map<(typeof unidades)[number], { grade: Record<string, number>; total: number }>();
        for (const g of grupos) {
          let max = g.pedido;
          for (const [mid, cons] of g.consPorMat) if (cons > 0) max = Math.min(max, Math.floor((remanescente.get(mid) ?? 0) / cons));
          if (max <= 0) continue;
          for (const [mid, cons] of g.consPorMat) remanescente.set(mid, (remanescente.get(mid) ?? 0) - cons * max);
          const cur = cortePorUnidade.get(g.u) ?? { grade: {}, total: 0 };
          if (g.tam) cur.grade[g.tam] = (cur.grade[g.tam] ?? 0) + max;
          cur.total += max;
          cortePorUnidade.set(g.u, cur);
        }
        const parciais = [...cortePorUnidade.entries()]
          .map(([u, v]) => ({ ...u, quantidade: v.total, grade: (Object.keys(v.grade).length ? v.grade : undefined) as Record<string, number> | undefined }))
          .filter((u) => u.quantidade > 0);
        const totalParcial = parciais.reduce((s, u) => s + u.quantidade, 0);
        const totalPedido = unidades.reduce((s, u) => s + u.quantidade, 0);
        const ratio = totalPedido > 0 ? totalParcial / totalPedido : 0;
        if (totalParcial > 0) {
          const necessarioParcial = new Map<number, Prisma.Decimal>();
          for (const u of parciais) {
            for (const b of bomPorItem.get(u.chave) ?? []) {
              necessarioParcial.set(b.materialId, (necessarioParcial.get(b.materialId) ?? new Prisma.Decimal(0)).plus(this.consumoDoItem(b, u)));
            }
          }
          const ocsAbertas = await this.prisma.ordemCompra.findMany({ where: { status: 'aguardando', motivo: motivoPedido, materialId: { in: faltantes.map((f) => f.material.id) } } });
          const jaComOC = new Set(ocsAbertas.map((o) => o.materialId));
          const aCriar = faltantes.filter((f) => !jaComOC.has(f.material.id));
          const res = await this.prisma.$transaction(async (tx) => {
            for (const [mid, nec] of necessarioParcial) await tx.material.update({ where: { id: mid }, data: { saldo: { decrement: nec } } });
            const ops: { id: number; numero: string; quantidade: number }[] = [];
            for (const u of parciais) {
              const numeroOp = await this.gerarNumeroOP(tx);
              const bom = u.produtoId ? bomPorItem.get(u.chave) ?? [] : [];
              const romaneio = bom.map((b) => { const m = materiais.find((x) => x.id === b.materialId)!; return { materialId: b.materialId, codigo: m.codigo, descricao: m.descricao, localizacao: m.localizacao ?? null, quantidade: Number(this.consumoDoItem(b, u).toFixed(4)), unidade: m.unidade, conferido: false }; });
              const op = await tx.oP.create({ data: { numero: numeroOp, pedidoId: pedido.id, filialId: pedido.filialId, produtoId: u.produtoId ?? null, cor: u.cor, quantidade: u.quantidade, status: 'a_iniciar', pilotoLiberado: true, progresso: 0, gradeTamanhos: (u.grade as Prisma.InputJsonValue | undefined) ?? undefined, romaneioMateriais: romaneio as Prisma.InputJsonValue, corteParcial: true, corteObs: 'CORTE OTIMIZADO (parcial) — priorize os TAMANHOS MENORES desta grade. Estoque parcial: corte primeiro os tamanhos menores (rendem mais peças por metro). O restante sai na OP complementar quando o tecido chegar.' } });
              ops.push({ id: op.id, numero: op.numero, quantidade: op.quantidade });
            }
            const criadas: { numero: string }[] = [];
            if (aCriar.length) {
              const forn = await this.fornecedorPlaceholder(tx, empresaId);
              for (const f of aCriar) { const numero = await this.gerarNumeroOC(tx); await tx.ordemCompra.create({ data: { numero, fornecedorId: forn.id, materialId: f.material.id, descricao: f.material.descricao, quantidade: f.faltam, unidade: f.material.unidade, valor: f.faltam.mul(f.material.custo), status: 'aguardando', motivo: motivoPedido } }); criadas.push({ numero }); }
            }
            await tx.pedido.update({ where: { id }, data: { etapa: 'producao', status: 'Em produção (parcial)', producaoParcial: true } });
            return { ops, ocs: criadas.length + ocsAbertas.length };
          });
          return {
            status: 'op_parcial' as const,
            pedido: { numero: pedido.numero, etapa: 'producao' },
            produzir: totalParcial,
            cobertura: Math.round(ratio * 100),
            ops: res.ops,
            ocs: res.ocs,
            message: `Produção PARCIAL liberada: ${totalParcial} peça(s) com o estoque atual (${Math.round(ratio * 100)}%). ${res.ocs} OC(s) do restante mantida(s). Gere a OP complementar quando o material chegar.`,
          };
        }
        // ratio cobre 0 peça → cai no bloqueio normal abaixo.
      }

      const ocsAbertas = await this.prisma.ordemCompra.findMany({
        where: { status: 'aguardando', motivo: motivoPedido, materialId: { in: faltantes.map((f) => f.material.id) } },
      });
      const jaComOC = new Set(ocsAbertas.map((o) => o.materialId));
      const aCriar = faltantes.filter((f) => !jaComOC.has(f.material.id));

      const novas = await this.prisma.$transaction(async (tx) => {
        const criadas: Awaited<ReturnType<typeof tx.ordemCompra.create>>[] = [];
        if (aCriar.length > 0) {
          const fornecedor = await this.fornecedorPlaceholder(tx, empresaId);
          for (const f of aCriar) {
            const numero = await this.gerarNumeroOC(tx);
            const oc = await tx.ordemCompra.create({
              data: {
                numero,
                fornecedorId: fornecedor.id,
                materialId: f.material.id,
                descricao: f.material.descricao,
                quantidade: f.faltam,
                unidade: f.material.unidade,
                valor: f.faltam.mul(f.material.custo),
                status: 'aguardando',
                motivo: motivoPedido,
              },
            });
            criadas.push(oc);
          }
        }
        if (pedido.etapa !== 'compra') {
          await tx.pedido.update({
            where: { id },
            data: { etapa: 'compra', status: 'Aguardando material' },
          });
        }
        return criadas;
      });

      const todasOCs = [...ocsAbertas, ...novas];
      return {
        status: 'bloqueado_material' as const,
        pedido: { numero: pedido.numero, etapa: 'compra' },
        ocsNovas: novas.length,
        ocsExistentes: ocsAbertas.length,
        message: novas.length
          ? `Faltou material: ${novas.length} ordem(ns) de compra gerada(s)${ocsAbertas.length ? ` (${ocsAbertas.length} já existia(m), não duplicadas)` : ''}. Pedido aguardando material.`
          : `Já existe(m) ${ocsAbertas.length} ordem(ns) de compra aberta(s) para este pedido — aguardando o material chegar. Nenhuma OC duplicada foi criada.`,
        faltantes: faltantes.map((f) => ({
          materialCodigo: f.material.codigo,
          descricao: f.material.descricao,
          necessario: f.necessario.toFixed(3),
          saldo: f.material.saldo.toFixed(3),
          faltam: f.faltam.toFixed(3),
          unidade: f.material.unidade,
        })),
        ordensCompra: todasOCs.map((o) => ({
          numero: o.numero,
          material: o.descricao,
          quantidade: o.quantidade.toFixed(3),
          valor: o.valor.toFixed(2),
          status: o.status,
        })),
      };
    }

    // 4) Material disponível → baixa saldo, gera UMA OP POR ITEM de produção e avança o pedido
    const resultado = await this.prisma.$transaction(async (tx) => {
      for (const [materialId, necessario] of necessarioPorMaterial) {
        await tx.material.update({
          where: { id: materialId },
          data: { saldo: { decrement: necessario } },
        });
      }
      const opsCriadas = [] as { id: number; numero: string; status: string; quantidade: number; produtoId: number | null }[];
      for (const u of unidades) {
        const numeroOp = await this.gerarNumeroOP(tx);
        // Romaneio da unidade = BOM do produto × quantidade (por tamanho quando houver).
        const bom = u.produtoId ? bomPorItem.get(u.chave) ?? [] : [];
        const romaneio = bom.map((b) => {
          const m = materiais.find((x) => x.id === b.materialId)!;
          return { materialId: b.materialId, codigo: m.codigo, descricao: m.descricao, localizacao: m.localizacao ?? null, quantidade: Number(this.consumoDoItem(b, u).toFixed(4)), unidade: m.unidade, conferido: false };
        });
        const op = await tx.oP.create({
          data: {
            numero: numeroOp,
            pedidoId: pedido.id,
            filialId: pedido.filialId,
            produtoId: u.produtoId ?? null,
            cor: u.cor,
            quantidade: u.quantidade,
            status: 'a_iniciar',
            pilotoLiberado: true,
            progresso: 0,
            gradeTamanhos: (u.grade as Prisma.InputJsonValue | undefined) ?? undefined,
            romaneioMateriais: romaneio as Prisma.InputJsonValue,
          },
        });
        opsCriadas.push({ id: op.id, numero: op.numero, status: op.status, quantidade: op.quantidade, produtoId: op.produtoId });
      }
      await tx.pedido.update({
        where: { id },
        data: { etapa: 'producao', status: 'Em produção', producaoParcial: false },
      });
      return opsCriadas;
    });

    return {
      status: 'op_gerada' as const,
      pedido: { numero: pedido.numero, etapa: 'producao' },
      ops: resultado.map((o) => ({ id: o.id, numero: o.numero, status: o.status, quantidade: o.quantidade })),
      op: resultado[0] ? { numero: resultado[0].numero, status: resultado[0].status, quantidade: resultado[0].quantidade } : null,
      revenda: itensRevenda.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade })),
      consumo: [...necessarioPorMaterial.entries()].map(([materialId, q]) => {
        const m = materiais.find((x) => x.id === materialId)!;
        return { material: m.codigo, descricao: m.descricao, baixado: q.toFixed(3), unidade: m.unidade };
      }),
    };
  }

  // ===== Helpers =====

  /**
   * Consumo total de um material para o item do pedido.
   * Se a BOM tem consumo POR TAMANHO e o item tem grade, soma tamanho×metros por tamanho;
   * senão, usa o consumo padrão × quantidade do item.
   */
  /** Escala uma grade de tamanhos por um fator (0..1), arredondando p/ baixo por tamanho. */
  private escalarGrade(grade: unknown, fator: number): unknown {
    const g = grade as Record<string, number> | null | undefined;
    if (!g || typeof g !== 'object') return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(g)) { const n = Math.floor((Number(v) || 0) * fator); if (n > 0) out[k] = n; }
    return Object.keys(out).length ? out : undefined;
  }

  private consumoDoItem(b: { quantidade: Prisma.Decimal; porTamanho?: unknown }, item: { quantidade: number; grade?: unknown }): Prisma.Decimal {
    const porTam = b.porTamanho as Record<string, number> | null | undefined;
    const grade = item.grade as Record<string, number> | null | undefined;
    if (porTam && grade && typeof grade === 'object') {
      let total = new Prisma.Decimal(0);
      for (const [tam, qtd] of Object.entries(grade)) {
        const q = Number(qtd) || 0;
        const consumoTam = Number(porTam[String(tam).toUpperCase()] ?? porTam[String(tam)] ?? 0);
        if (q > 0 && consumoTam > 0) total = total.plus(new Prisma.Decimal(consumoTam).mul(q));
      }
      if (total.greaterThan(0)) return total;
    }
    return b.quantidade.mul(item.quantidade);
  }

  /** Normaliza a grade de tamanhos do item; se houver, a quantidade = soma da grade. */
  private normalizarGrade(item: { grade?: Record<string, number>; quantidade: number }): { grade?: Prisma.InputJsonValue; quantidade: number } {
    const g = item.grade;
    if (g && typeof g === 'object') {
      const limpa: Record<string, number> = {};
      let soma = 0;
      for (const [t, q] of Object.entries(g)) {
        const n = Math.round(Number(q));
        if (t && Number.isFinite(n) && n > 0) { limpa[String(t).toUpperCase()] = n; soma += n; }
      }
      if (soma > 0) return { grade: limpa, quantidade: soma };
    }
    return { grade: undefined, quantidade: item.quantidade };
  }

  /** Tamanhos que usam a tabela de preço especial (ex.: "G1,G2,G3,G4,G5"). */
  static tamsEspeciais(produto: Produto | null): string[] {
    return produto?.tamsEspeciais
      ? String(produto.tamsEspeciais).split(/[,;/.\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
  }

  /** Preço unitário de um tamanho: usa precoEspecial quando o tamanho é da faixa especial. */
  static precoTamanho(produto: Produto | null, valorUnitBase: Prisma.Decimal, tam: string): Prisma.Decimal {
    if (produto?.precoEspecial != null && PedidosService.tamsEspeciais(produto).includes(String(tam).toUpperCase())) {
      return new Prisma.Decimal(produto.precoEspecial);
    }
    return valorUnitBase;
  }

  /** Subtotal do item respeitando as faixas de preço por tamanho (quando há grade). */
  private subtotalItem(
    produto: Produto | null,
    valorUnitBase: Prisma.Decimal,
    grade: Prisma.InputJsonValue | undefined,
    quantidade: number,
  ): Prisma.Decimal {
    if (grade && typeof grade === 'object') {
      let s = new Prisma.Decimal(0);
      for (const [tam, q] of Object.entries(grade as Record<string, number>)) {
        s = s.plus(PedidosService.precoTamanho(produto, valorUnitBase, tam).mul(Number(q) || 0));
      }
      return s;
    }
    return valorUnitBase.mul(quantidade);
  }

  /** Resolve a filial emissora: a informada (validada) ou a matriz da empresa. */
  private async resolverFilial(empresaId: number, filialId?: number): Promise<number | null> {
    if (filialId) {
      const f = await this.prisma.filial.findUnique({ where: { id: filialId } });
      if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Filial ${filialId} não encontrada.`);
      if (!f.ativa) throw new BadRequestException('Filial inativa — escolha uma filial ativa.');
      return f.id;
    }
    const matriz = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    return matriz?.id ?? null;
  }

  private async gerarNumeroPedido(empresaId: number): Promise<string> {
    const existentes = await this.prisma.pedido.findMany({
      where: { empresaId },
      select: { numero: true },
    });
    return proximoSequencial('PV', existentes.map((p) => p.numero), { pad: 2 });
  }

  private async gerarNumeroOP(tx: Prisma.TransactionClient): Promise<string> {
    const existentes = await tx.oP.findMany({ select: { numero: true } });
    return proximoSequencial('OP', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }

  private async gerarNumeroOC(tx: Prisma.TransactionClient): Promise<string> {
    const existentes = await tx.ordemCompra.findMany({ select: { numero: true } });
    return proximoSequencial('OC', existentes.map((o) => o.numero), { pad: 4, separador: '-' });
  }

  /** Fornecedor "A DEFINIR" para OCs automáticas (compras ajusta depois). */
  private async fornecedorPlaceholder(tx: Prisma.TransactionClient, empresaId: number) {
    const existente = await tx.fornecedor.findFirst({
      where: { empresaId, nome: 'A DEFINIR' },
    });
    if (existente) return existente;
    return tx.fornecedor.create({
      data: { empresaId, nome: 'A DEFINIR', tipo: 'Reposição automática' },
    });
  }
}
