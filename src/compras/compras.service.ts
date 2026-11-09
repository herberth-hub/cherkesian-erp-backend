import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Material, OrdemCompra, OrdemCompraItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrdemCompraDto, OrdemCompraItemDto } from './dto/create-ordem-compra.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Os itens sempre saem na mesma ordem em que foram lançados. */
  private static readonly INCLUI_ITENS = { orderBy: [{ ordem: 'asc' as const }, { id: 'asc' as const }] };

  async findAll(empresaId: number) {
    const ocs = await this.prisma.ordemCompra.findMany({
      where: { fornecedor: { empresaId } },
      orderBy: { id: 'desc' },
      include: {
        fornecedor: { select: { nome: true } },
        notaEntrada: { select: { numero: true } },
        itens: ComprasService.INCLUI_ITENS,
      },
    });
    // Sinaliza quando a baixa veio de uma NF de entrada (necessidade × compra).
    return ocs.map((o) => ({ ...o, recebidaViaNf: o.notaEntrada?.numero ?? null }));
  }

  async findOne(id: number, empresaId: number): Promise<OrdemCompra> {
    const oc = await this.prisma.ordemCompra.findUnique({
      where: { id },
      include: {
        fornecedor: { select: { empresaId: true, nome: true } },
        itens: ComprasService.INCLUI_ITENS,
      },
    });
    if (!oc || oc.fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Ordem de compra ${id} não encontrada.`);
    }
    return oc;
  }

  /**
   * Os materiais que a ordem vai repor, com a quantidade de cada um.
   *
   * Ordem de item único: é o par (materialId, quantidade) do cabeçalho.
   * Ordem com itens: uma entrada por linha — e é por isso que a baixa do
   * recebimento precisa passar por aqui, e não pelo cabeçalho, que agora é só o
   * total.
   */
  private materiaisDaOrdem(oc: OrdemCompra & { itens?: OrdemCompraItem[] }): Array<{ materialId: number; quantidade: Prisma.Decimal }> {
    if (oc.itens?.length) {
      return oc.itens
        .filter((i): i is OrdemCompraItem & { materialId: number } => i.materialId != null)
        .map((i) => ({ materialId: i.materialId, quantidade: i.quantidade }));
    }
    return oc.materialId != null ? [{ materialId: oc.materialId, quantidade: oc.quantidade }] : [];
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

    // ===== ORDEM COM VÁRIOS ITENS =====
    if (dto.itens?.length) {
      const itens = await this.prepararItens(dto.itens, empresaId);
      const resumo = this.resumoDosItens(itens);
      return this.prisma.ordemCompra.create({
        data: {
          numero,
          fornecedorId: dto.fornecedorId,
          filialId: dto.filialId,
          // O cabeçalho vira o RESUMO: material/produto ficam nos itens, e quem
          // precisa saber o que a ordem repõe usa `materiaisDaOrdem`.
          materialId: null,
          produtoId: null,
          codigoFornecedor: dto.codigoFornecedor?.trim() || null,
          descricaoFornecedor: dto.descricaoFornecedor?.trim() || null,
          descricao: resumo.descricao,
          quantidade: resumo.quantidade,
          unidade: resumo.unidade,
          valor: resumo.valor,
          status: 'aguardando',
          previsao: dto.previsao ? new Date(dto.previsao) : undefined,
          motivo: dto.motivo,
          itens: { create: itens },
        },
        include: { itens: ComprasService.INCLUI_ITENS },
      });
    }

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

  /** Valida cada linha (material/produto da empresa) e calcula o total dela. */
  private async prepararItens(itens: OrdemCompraItemDto[], empresaId: number) {
    const matIds = [...new Set(itens.map((i) => i.materialId).filter((x): x is number => x != null))];
    const prodIds = [...new Set(itens.map((i) => i.produtoId).filter((x): x is number => x != null))];
    const vazio: Array<{ id: number; empresaId: number }> = [];
    const [mats, prods] = await Promise.all([
      matIds.length ? this.prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true, empresaId: true } }) : vazio,
      prodIds.length ? this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, empresaId: true } }) : vazio,
    ]);
    const mOk = new Set(mats.filter((m) => m.empresaId === empresaId).map((m) => m.id));
    const pOk = new Set(prods.filter((p) => p.empresaId === empresaId).map((p) => p.id));
    for (const id of matIds) if (!mOk.has(id)) throw new NotFoundException(`Material ${id} não encontrado.`);
    for (const id of prodIds) if (!pOk.has(id)) throw new NotFoundException(`Produto ${id} não encontrado.`);

    return itens.map((i, ordem) => {
      // Grade por tamanho: a quantidade da linha passa a ser a SOMA da grade.
      let grade: Prisma.InputJsonValue | undefined;
      let quantidade = i.quantidade;
      if (i.grade && typeof i.grade === 'object') {
        const limpo: Record<string, number> = {};
        let soma = 0;
        for (const [t, q] of Object.entries(i.grade)) { const n = Math.round(Number(q)); if (t && n > 0) { limpo[String(t).toUpperCase()] = n; soma += n; } }
        if (soma > 0) { grade = limpo as Prisma.InputJsonValue; quantidade = soma; }
      }
      return {
        materialId: i.materialId ?? null,
        produtoId: i.produtoId ?? null,
        descricao: i.descricao.trim(),
        codigoFornecedor: i.codigoFornecedor?.trim() || null,
        descricaoFornecedor: i.descricaoFornecedor?.trim() || null,
        grade,
        quantidade: new Prisma.Decimal(quantidade),
        unidade: i.unidade.trim(),
        valorUnit: new Prisma.Decimal(i.valorUnit),
        // O total da linha é SEMPRE calculado: preço digitado × quantidade. Não
        // existe total informado à parte que possa discordar do unitário.
        valor: new Prisma.Decimal(quantidade).mul(i.valorUnit).toDecimalPlaces(2),
        ordem,
      };
    });
  }

  /** O que o cabeçalho passa a mostrar quando a ordem tem itens. */
  private resumoDosItens(itens: Array<{ descricao: string; quantidade: Prisma.Decimal; unidade: string; valor: Prisma.Decimal }>) {
    const valor = itens.reduce((s, i) => s.add(i.valor), new Prisma.Decimal(0));
    const unidades = new Set(itens.map((i) => i.unidade));
    // Só soma a quantidade quando todas as linhas falam a mesma língua: somar
    // 40 un com 3 m daria um número que não quer dizer nada.
    const mesmaUnidade = unidades.size === 1;
    const quantidade = mesmaUnidade
      ? itens.reduce((s, i) => s.add(i.quantidade), new Prisma.Decimal(0))
      : new Prisma.Decimal(itens.length);
    return {
      descricao: itens.length === 1 ? itens[0].descricao : `${itens.length} itens · ${itens[0].descricao}…`,
      quantidade,
      unidade: mesmaUnidade ? itens[0].unidade : 'itens',
      valor: valor.toDecimalPlaces(2),
    };
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
    const reposicao = this.materiaisDaOrdem(oc);
    if (!force && reposicao.length) {
      const dias45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      const nf = await this.prisma.notaEntrada.findFirst({
        where: { empresaId, lancadaEstoque: true, criadoEm: { gte: dias45 }, itens: { some: { materialId: { in: reposicao.map((r) => r.materialId) } } } },
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

    // Numa ordem com itens, CADA linha repõe o seu material. Antes isso lia só o
    // cabeçalho — que agora é o total — e repor pelo total somaria tudo num
    // material só.
    const [atualizada] = await this.prisma.$transaction([
      this.prisma.ordemCompra.update({ where: { id }, data: { status: 'recebida', situacao: 'recebido', recebidaEm: new Date() } }),
      ...reposicao.map((r) =>
        this.prisma.material.update({ where: { id: r.materialId }, data: { saldo: { increment: r.quantidade } } }),
      ),
    ]);
    return atualizada;
  }

  /**
   * UNIFICA várias ordens do MESMO fornecedor numa só, com vários itens.
   *
   * Comprar duas cores do mesmo zíper virava duas ordens — dois documentos para
   * o mesmo fornecedor, na mesma compra. Aqui elas viram uma: cada ordem antiga
   * entra como uma linha, e as originais são CANCELADAS (não apagadas), com o
   * número da nova no motivo, para o histórico continuar legível.
   *
   * Só unifica o que ainda não andou: ordem já recebida, cancelada ou enviada
   * ao fornecedor fica de fora — o fornecedor já viu aquele documento.
   */
  async unificar(ids: number[], empresaId: number) {
    const unicos = [...new Set(ids)];
    if (unicos.length < 2) throw new BadRequestException('Informe ao menos 2 ordens para unificar.');

    const ocs = await this.prisma.ordemCompra.findMany({
      where: { id: { in: unicos } },
      include: { fornecedor: { select: { empresaId: true, nome: true } }, itens: ComprasService.INCLUI_ITENS },
      orderBy: { id: 'asc' },
    });
    if (ocs.length !== unicos.length) throw new NotFoundException('Alguma das ordens não foi encontrada.');
    for (const o of ocs) {
      if (o.fornecedor.empresaId !== empresaId) throw new NotFoundException(`Ordem ${o.numero} não encontrada.`);
      if (o.status !== 'aguardando') throw new ConflictException(`${o.numero} não está aguardando (status: ${o.status}) — não dá para unificar.`);
      if (o.enviadaEm) throw new ConflictException(`${o.numero} já foi enviada ao fornecedor em ${o.enviadaEm.toISOString().slice(0, 10)} — unificar agora deixaria o fornecedor com dois documentos diferentes.`);
    }
    const fornecedores = new Set(ocs.map((o) => o.fornecedorId));
    if (fornecedores.size > 1) throw new ConflictException('As ordens são de fornecedores diferentes — cada fornecedor recebe o documento dele.');
    const filiais = new Set(ocs.map((o) => o.filialId ?? 0));
    if (filiais.size > 1) throw new ConflictException('As ordens são de CNPJs compradores diferentes — defina o mesmo comprador antes de unificar.');

    // Cada ordem antiga vira uma ou mais linhas (se ela já tinha itens, todos vêm).
    let ordem = 0;
    const itens = ocs.flatMap((o) =>
      o.itens.length
        ? o.itens.map((i) => ({
            materialId: i.materialId, produtoId: i.produtoId, descricao: i.descricao,
            codigoFornecedor: i.codigoFornecedor, descricaoFornecedor: i.descricaoFornecedor,
            grade: (i.grade ?? undefined) as Prisma.InputJsonValue | undefined,
            quantidade: i.quantidade, unidade: i.unidade, valorUnit: i.valorUnit, valor: i.valor, ordem: ordem++,
          }))
        : [{
            materialId: o.materialId, produtoId: o.produtoId, descricao: o.descricao,
            codigoFornecedor: o.codigoFornecedor, descricaoFornecedor: o.descricaoFornecedor,
            grade: (o.grade ?? undefined) as Prisma.InputJsonValue | undefined,
            quantidade: o.quantidade, unidade: o.unidade,
            // A ordem antiga guarda só o TOTAL; o unitário sai dele.
            valorUnit: o.quantidade.isZero() ? new Prisma.Decimal(0) : o.valor.div(o.quantidade).toDecimalPlaces(4),
            valor: o.valor, ordem: ordem++,
          }],
    );
    const resumo = this.resumoDosItens(itens);
    const base = ocs[0];
    const numero = await this.gerarNumero();
    const origem = ocs.map((o) => o.numero).join(', ');

    const [nova] = await this.prisma.$transaction([
      this.prisma.ordemCompra.create({
        data: {
          numero,
          fornecedorId: base.fornecedorId,
          filialId: base.filialId,
          materialId: null,
          produtoId: null,
          codigoFornecedor: base.codigoFornecedor,
          descricaoFornecedor: base.descricaoFornecedor,
          descricao: resumo.descricao,
          quantidade: resumo.quantidade,
          unidade: resumo.unidade,
          valor: resumo.valor,
          status: 'aguardando',
          // A previsão mais apertada manda: é a data que a fábrica precisa.
          previsao: ocs.map((o) => o.previsao).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
          motivo: base.motivo ? `${base.motivo} · unificada de ${origem}` : `Unificada de ${origem}`,
          itens: { create: itens },
        },
        include: { itens: ComprasService.INCLUI_ITENS },
      }),
      this.prisma.ordemCompra.updateMany({
        where: { id: { in: unicos } },
        data: { status: 'cancelada', motivo: `Unificada na ${numero}` },
      }),
    ]);
    return { ...nova, unificou: ocs.map((o) => o.numero) };
  }

  /**
   * Corrige a QUANTIDADE e/ou o PREÇO de linhas de uma ordem.
   *
   * Só mexe no que ainda não andou: ordem recebida ou cancelada está fechada, e
   * ordem já ENVIADA o fornecedor já leu — mudar o número por trás dele é como
   * a compra chega errada. Nesses casos, cancele e faça outra.
   *
   * O total da linha e o resumo do cabeçalho são sempre RECALCULADOS: não existe
   * caminho em que a soma da ordem discorde das linhas.
   */
  async atualizarItens(
    id: number,
    alteracoes: Array<{ id: number; quantidade?: number; valorUnit?: number }>,
    empresaId: number,
  ) {
    const oc = await this.findOne(id, empresaId) as OrdemCompra & { itens: OrdemCompraItem[] };
    if (oc.status !== 'aguardando') throw new ConflictException(`${oc.numero} não está aguardando (status: ${oc.status}).`);
    if (oc.enviadaEm) throw new ConflictException(`${oc.numero} já foi enviada ao fornecedor em ${oc.enviadaEm.toISOString().slice(0, 10)}. Mudar a quantidade agora deixaria o pedido dele diferente do nosso — cancele e faça outra.`);
    if (!oc.itens.length) throw new ConflictException(`${oc.numero} não tem itens: é uma ordem de linha única (edite a ordem inteira).`);
    if (!alteracoes.length) throw new BadRequestException('Informe ao menos um item para alterar.');

    const porId = new Map(oc.itens.map((i) => [i.id, i]));
    const novos = new Map<number, { quantidade: Prisma.Decimal; valorUnit: Prisma.Decimal; valor: Prisma.Decimal }>();
    for (const a of alteracoes) {
      const item = porId.get(a.id);
      if (!item) throw new NotFoundException(`Item ${a.id} não é desta ordem.`);
      const quantidade = a.quantidade != null ? new Prisma.Decimal(a.quantidade) : item.quantidade;
      const valorUnit = a.valorUnit != null ? new Prisma.Decimal(a.valorUnit) : item.valorUnit;
      if (quantidade.lessThanOrEqualTo(0)) throw new BadRequestException(`Quantidade de "${item.descricao}" deve ser maior que zero. Para tirar o item, cancele a ordem e faça outra.`);
      if (valorUnit.lessThanOrEqualTo(0)) throw new BadRequestException(`Preço de "${item.descricao}" deve ser maior que zero.`);
      novos.set(a.id, { quantidade, valorUnit, valor: quantidade.mul(valorUnit).toDecimalPlaces(2) });
    }

    // A grade por tamanho descreve a quantidade antiga; mudar a quantidade na mão
    // sem mexer na grade deixaria as duas discordando dentro do mesmo item.
    for (const [itemId, n] of novos) {
      const item = porId.get(itemId)!;
      if (item.grade && !n.quantidade.equals(item.quantidade)) {
        throw new ConflictException(`"${item.descricao}" é comprado por grade de tamanhos — altere a grade, não a quantidade total.`);
      }
    }

    const finais = oc.itens.map((i) => ({ ...i, ...(novos.get(i.id) ?? {}) }));
    const resumo = this.resumoDosItens(finais);

    // Um update só: cabeçalho e linhas mudam juntos ou não mudam.
    return this.prisma.ordemCompra.update({
      where: { id },
      data: {
        descricao: resumo.descricao,
        quantidade: resumo.quantidade,
        unidade: resumo.unidade,
        valor: resumo.valor,
        itens: {
          update: [...novos].map(([itemId, n]) => ({
            where: { id: itemId },
            data: { quantidade: n.quantidade, valorUnit: n.valorUnit, valor: n.valor },
          })),
        },
      },
      include: { itens: ComprasService.INCLUI_ITENS },
    });
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
      // Linha de receita por FAMÍLIA só vira material quando a cor do pedido é
      // conhecida (isso acontece na OP). Aqui, sem cor, não dá para somar demanda.
      if (!c.materialId || !c.material) continue;
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
