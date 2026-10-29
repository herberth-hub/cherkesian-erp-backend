import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { proximoSequencial } from '../common/utils/codigo.util';
import { planoCobranca } from '../common/utils/vencimentos.util';
import { subtotalDaGrade } from '../common/utils/preco-faixa.util';

/**
 * VENDA DE COMODATO — "o cliente vendeu, agora ele paga".
 *
 * O comodato deixa a peça na loja do cliente sem cobrar nada: ela continua
 * nossa. A cobrança só existe quando ele vende. Esse é o momento perigoso do
 * ciclo: é onde a peça sai do nosso estoque E vira dinheiro a receber, e as
 * duas coisas têm de acontecer juntas. Fazer na mão (baixar a etiqueta aqui,
 * lançar o título ali) é o caminho curto para peça baixada sem título — ou,
 * pior, título lançado duas vezes sobre a mesma peça.
 *
 * Por isso aqui é uma operação só: baixa as etiquetas, cria o pedido de venda
 * com o preço de contrato e lança o(s) título(s) a receber, na mesma transação.
 * O título nasce amarrado ao pedido, então a comissão automática da quitação
 * funciona sem nenhum passo extra.
 */
@Injectable()
export class ComodatoVendaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Folga para o Neon (pooled, instância que hiberna) — igual à produção. */
  private static readonly TX = { maxWait: 15_000, timeout: 30_000 } as const;

  /**
   * Lê as etiquetas e monta o que seria cobrado. NÃO escreve nada — é o mesmo
   * cálculo que a venda usa, para a prévia na tela não poder divergir do que
   * vai ser lançado.
   */
  private async montar(codigosRaw: string[], empresaId: number, precos?: Record<string, number>) {
    const codigos = [...new Set((codigosRaw ?? []).map((c) => String(c ?? '').trim()).filter(Boolean))];
    if (!codigos.length) throw new BadRequestException('Selecione as etiquetas que o cliente vendeu.');
    if (codigos.length > 500) throw new BadRequestException('Máximo de 500 etiquetas por venda.');

    const uns = await this.prisma.unidadeEstoque.findMany({
      where: { codigo: { in: codigos }, empresaId },
      select: { codigo: true, status: true, descricao: true, cor: true, tamanho: true, produtoId: true, qualidade: true, comodatoClienteId: true },
    });
    const achados = new Set(uns.map((u) => u.codigo));
    const naoAchadas = codigos.filter((c) => !achados.has(c));
    if (naoAchadas.length) {
      throw new NotFoundException(`Etiqueta(s) não encontrada(s): ${naoAchadas.slice(0, 5).join(', ')}${naoAchadas.length > 5 ? '…' : ''}`);
    }
    // Só peça que ESTÁ em comodato pode ser vendida por aqui. Peça da prateleira
    // se vende pelo pedido normal; peça já despachada cobraria duas vezes.
    const fora = uns.filter((u) => u.status !== 'comodato');
    if (fora.length) {
      throw new BadRequestException(
        `${fora.length} etiqueta(s) não estão em comodato (ex.: ${fora.slice(0, 3).map((u) => `${u.codigo} · ${u.status}`).join(', ')}). ` +
        'Venda de comodato só baixa peça que está na loja do cliente.',
      );
    }
    const clientes = [...new Set(uns.map((u) => u.comodatoClienteId))];
    if (clientes.length > 1) throw new BadRequestException('As etiquetas estão em lojas de clientes diferentes — faça uma venda por cliente.');
    const clienteId = clientes[0];
    if (clienteId == null) throw new BadRequestException('Etiqueta em comodato sem cliente — corrija o endereçamento antes de cobrar.');

    const prodIds = [...new Set(uns.map((u) => u.produtoId).filter((x): x is number => x != null))];
    const [cliente, contratos, produtos] = await Promise.all([
      this.prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { id: true, nome: true, fantasia: true, representante: true, comissaoPercent: true, comissaoComImposto: true },
      }),
      this.prisma.contrato.findMany({
        where: { empresaId, clienteId, ativo: true, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }] },
        select: { id: true, numero: true, filialId: true, vendedor: true, formaPagamento: true, condicaoPagamento: true, itens: { select: { produtoId: true, preco: true } } },
        orderBy: { id: 'desc' },
      }),
      prodIds.length
        ? this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true, descricao: true, precoBase: true, precoEspecial: true, tamsEspeciais: true } })
        : Promise.resolve([]),
    ]);
    if (!cliente) throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    const pMap = new Map(produtos.map((p) => [p.id, p]));

    // Agrupa por produto + cor; os tamanhos viram a grade da linha (é a grade
    // que faz o preço de tamanho grande entrar certo no subtotal).
    type Linha = {
      produtoId: number | null; itemCodigo: string | null; descricao: string; cor: string | null;
      grade: Record<string, number>; quantidade: number; segunda: number; codigos: string[];
      precoUnit: number; precoOrigem: 'contrato' | 'tabela' | 'informado' | null; contrato: string | null; subtotal: number;
    };
    const mapa = new Map<string, Linha>();
    for (const u of uns) {
      const chave = `${u.produtoId ?? 'd:' + u.descricao}|${u.cor ?? ''}`;
      let l = mapa.get(chave);
      if (!l) {
        const p = u.produtoId != null ? pMap.get(u.produtoId) : undefined;
        l = {
          produtoId: u.produtoId, itemCodigo: p?.codigo ?? null, descricao: u.descricao, cor: u.cor,
          grade: {}, quantidade: 0, segunda: 0, codigos: [],
          precoUnit: 0, precoOrigem: null, contrato: null, subtotal: 0,
        };
        mapa.set(chave, l);
      }
      const tam = (u.tamanho || 'ÚNICO').toUpperCase();
      l.grade[tam] = (l.grade[tam] ?? 0) + 1;
      l.quantidade++;
      if (u.qualidade === 'segunda') l.segunda++;
      l.codigos.push(u.codigo);
    }

    // Preço de cada linha: o informado na hora > o do contrato vigente > a tabela
    // do produto. Sem nenhum dos três a venda não sai — cobrar R$ 0,00 seria
    // entregar a peça de graça e ainda sumir com ela do estoque.
    const semPreco: string[] = [];
    for (const l of mapa.values()) {
      const p = l.produtoId != null ? pMap.get(l.produtoId) : undefined;
      const manual = l.produtoId != null ? precos?.[String(l.produtoId)] : undefined;
      let base: Prisma.Decimal | null = null;
      if (manual != null && Number(manual) > 0) { base = new Prisma.Decimal(Number(manual).toFixed(2)); l.precoOrigem = 'informado'; }
      if (!base && l.produtoId != null) {
        for (const c of contratos) {
          const ci = c.itens.find((x) => x.produtoId === l.produtoId);
          if (ci && ci.preco != null && Number(ci.preco) > 0) { base = new Prisma.Decimal(ci.preco); l.precoOrigem = 'contrato'; l.contrato = c.numero ?? `#${c.id}`; break; }
        }
      }
      if (!base && p?.precoBase != null && Number(p.precoBase) > 0) { base = new Prisma.Decimal(p.precoBase); l.precoOrigem = 'tabela'; }
      if (!base) { semPreco.push(`${l.itemCodigo ?? ''} ${l.descricao}${l.cor ? ' · ' + l.cor : ''}`.trim()); continue; }
      l.precoUnit = Number(base);
      l.subtotal = Number(subtotalDaGrade(p ?? null, base, l.grade, l.quantidade).toFixed(2));
    }

    const linhas = [...mapa.values()].sort((a, b) => b.subtotal - a.subtotal);
    const total = Number(linhas.reduce((s, l) => s + l.subtotal, 0).toFixed(2));
    // Contrato que vale para a venda: o primeiro que tabelou alguma linha.
    const contratoUsado = contratos.find((c) => linhas.some((l) => l.contrato === (c.numero ?? `#${c.id}`))) ?? null;

    return {
      cliente: { id: cliente.id, nome: cliente.fantasia || cliente.nome, representante: cliente.representante, comissaoPercent: cliente.comissaoPercent, comissaoComImposto: cliente.comissaoComImposto },
      contrato: contratoUsado,
      linhas, total, semPreco,
      codigos: uns.map((u) => u.codigo),
      pecas: uns.length,
    };
  }

  /** Prévia da cobrança — a tela mostra isto antes de qualquer escrita. */
  async previa(codigos: string[], empresaId: number, precos?: Record<string, number>) {
    const m = await this.montar(codigos, empresaId, precos);
    return {
      cliente: m.cliente.nome,
      clienteId: m.cliente.id,
      pecas: m.pecas,
      total: m.total,
      contrato: m.contrato ? (m.contrato.numero ?? `#${m.contrato.id}`) : null,
      formaPagamento: m.contrato?.condicaoPagamento || m.contrato?.formaPagamento || null,
      semPreco: m.semPreco,
      linhas: m.linhas.map((l) => ({
        produtoId: l.produtoId,
        itemCodigo: l.itemCodigo, descricao: l.descricao, cor: l.cor, grade: l.grade,
        quantidade: l.quantidade, segunda: l.segunda,
        precoUnit: l.precoUnit, precoOrigem: l.precoOrigem, contrato: l.contrato, subtotal: l.subtotal,
      })),
    };
  }

  /**
   * O cliente VENDEU: baixa as etiquetas, cria o pedido e lança o título.
   *
   * Tudo numa transação só — se o título não entrar, a peça não sai do estoque.
   */
  async registrarVenda(
    dto: {
      codigos: string[]; precos?: Record<string, number>;
      vencimento?: string; formaPagamento?: string; parcelas?: number;
      cobrar?: 'boleto' | 'transferencia'; filialId?: number; obs?: string;
    },
    empresaId: number,
    usuario: string,
  ) {
    const m = await this.montar(dto.codigos, empresaId, dto.precos);
    if (m.semPreco.length) {
      throw new BadRequestException(
        `Sem preço para: ${m.semPreco.join('; ')}. Ponha no contrato do cliente, na tabela do produto, ou informe o preço nesta venda.`,
      );
    }
    if (!(m.total > 0)) throw new BadRequestException('O total ficou em R$ 0,00 — confira os preços antes de lançar.');

    // Filial emissora: a escolhida, a do contrato, ou a matriz.
    const filialId = await this.resolverFilial(empresaId, dto.filialId ?? m.contrato?.filialId ?? undefined);
    const forma = (dto.formaPagamento ?? m.contrato?.condicaoPagamento ?? m.contrato?.formaPagamento ?? '').trim();
    let vencimentos: Date[]; let valores: number[];
    try {
      ({ vencimentos, valores } = planoCobranca(m.total, forma, dto));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const numero = proximoSequencial(
      'PV',
      (await this.prisma.pedido.findMany({ where: { empresaId }, select: { numero: true } })).map((p) => p.numero),
      { pad: 2 },
    );
    const agora = new Date();
    const resumo = `Venda de comodato · ${m.pecas} peça(s) na loja de ${m.cliente.nome}`;

    const r = await this.prisma.$transaction(async (tx) => {
      // 1. Pedido + itens numa escrita (o pedido já nasce entregue: a mercadoria
      //    está com o cliente desde que foi para a loja dele).
      const pedido = await tx.pedido.create({
        data: {
          empresaId, numero, clienteId: m.cliente.id, filialId: filialId ?? undefined,
          data: agora, valorTotal: new Prisma.Decimal(m.total.toFixed(2)),
          status: 'Venda de comodato', etapa: 'concluido',
          formaPagamento: forma || undefined,
          obsComercial: [resumo, dto.obs].filter(Boolean).join(' · '),
          // Carteira do cliente — é o que faz a comissão sair certa na quitação.
          comissaoRepresentante: m.contrato?.vendedor || m.cliente.representante || undefined,
          comissaoPercent: m.cliente.comissaoPercent ?? undefined,
          comissaoComImposto: m.cliente.comissaoComImposto ?? undefined,
          criadoPor: usuario,
          itens: {
            create: m.linhas.map((l) => ({
              produtoId: l.produtoId ?? undefined,
              descricao: l.descricao, cor: l.cor ?? undefined,
              quantidade: l.quantidade, quantidadeExpedida: l.quantidade,
              valorUnit: new Prisma.Decimal(l.precoUnit.toFixed(2)),
              grade: l.grade as Prisma.InputJsonValue,
              gradeExpedida: l.grade as Prisma.InputJsonValue,
            })),
          },
        },
        select: { id: true, numero: true },
      });

      // 2. As peças saem do estoque, amarradas ao pedido que as cobrou.
      const baixa = await tx.unidadeEstoque.updateMany({
        where: { codigo: { in: m.codigos }, empresaId, status: 'comodato' },
        data: { status: 'despachado', saidaEm: agora, pedidoId: pedido.id },
      });
      // Corrida: alguém baixou/moveu a peça entre a leitura e a escrita. Aborta
      // a transação inteira em vez de cobrar por peça que já saiu por outro caminho.
      if (baixa.count !== m.codigos.length) {
        throw new BadRequestException(
          `${m.codigos.length - baixa.count} etiqueta(s) saíram do comodato enquanto esta venda era montada — refaça a seleção.`,
        );
      }

      // 3. Título(s) a receber. Sem NF ainda: o documento de origem é o pedido.
      await tx.contaReceber.createMany({
        data: vencimentos.map((v, i) => ({
          empresaId, clienteId: m.cliente.id, pedidoId: pedido.id,
          filialId: filialId ?? undefined, documento: pedido.numero, notaFiscalId: null,
          valor: new Prisma.Decimal(valores[i].toFixed(2)), vencimento: v, status: 'a_vencer' as const,
          formaCobranca: dto.cobrar ?? undefined,
        })),
      });
      return pedido;
    }, ComodatoVendaService.TX);

    await this.prisma.log.create({
      data: {
        usuario, acao: 'comodato.venda',
        detalhe: `${resumo} · ${r.numero} · R$ ${m.total.toFixed(2)} em ${vencimentos.length} título(s)`
          + (m.contrato ? ` · contrato ${m.contrato.numero ?? '#' + m.contrato.id}` : '')
          + ` · etiquetas: ${m.codigos.join(', ')}`,
        entidade: 'Pedido', entidadeId: String(r.id),
      },
    }).catch(() => undefined);

    return {
      pedido: r.numero, pedidoId: r.id, cliente: m.cliente.nome, pecas: m.pecas, total: m.total,
      titulos: vencimentos.length,
      vencimentos: vencimentos.map((v) => v.toISOString().slice(0, 10)),
      contrato: m.contrato ? (m.contrato.numero ?? `#${m.contrato.id}`) : null,
      forma: dto.cobrar ?? null,
    };
  }

  /** Filial emissora: a informada (validada) ou a matriz da empresa. */
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
}
