import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Produto } from '@prisma/client';
import { NfeService } from '../nfe/nfe.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { EmailService } from '../email/email.service';
import { LogsService } from '../logs/logs.service';
import { AuthUser } from '../auth/auth.types';
import { CriarPedidoPortalDto } from './dto/criar-pedido-portal.dto';

/**
 * Portal do Cliente — visão EXTERNA e somente-leitura para o próprio cliente.
 * Mostra só o que é DELE: estoque pronta-entrega e o andamento/prazo dos pedidos.
 * Nada de custo, margem, outros clientes ou telas internas.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfe: NfeService,
    private readonly pedidos: PedidosService,
    private readonly notificacoes: NotificacoesService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly logs: LogsService,
  ) {}

  /** Quem está assinando a ação no portal (aparece na trilha de auditoria do ERP). */
  private quemAssina(user: AuthUser) {
    return String(user.usuario || user.nome || 'portal').slice(0, 150);
  }

  /**
   * Resolve o clienteId do escopo. Para o perfil `cliente` vem travado no token
   * (ignora qualquer parâmetro). Para admin (`total`) permite pré-visualizar um
   * cliente específico via ?clienteId= (útil para conferir o portal do cliente).
   */
  private async escopo(user: AuthUser, override?: number): Promise<number> {
    if (user.acesso === 'cliente') {
      if (!user.clienteId) {
        throw new ForbiddenException('Login de cliente sem vínculo. Contate o fornecedor.');
      }
      return user.clienteId;
    }
    if (user.acesso === 'total') {
      if (!override) {
        throw new BadRequestException('Informe ?clienteId= para pré-visualizar o portal.');
      }
      return override;
    }
    throw new ForbiddenException('Área exclusiva do portal do cliente.');
  }

  private async clienteDoEscopo(user: AuthUser, override?: number) {
    const clienteId = await this.escopo(user, override);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId: user.empresaId },
      select: { id: true, nome: true, fantasia: true, grupo: true },
    });
    if (!cliente) {
      throw new ForbiddenException('Cliente do portal não encontrado.');
    }
    return cliente;
  }

  /**
   * Produtos "donos" do cliente: casam por clienteId direto OU pelo grupo do
   * cliente (clienteGrupo). É o mesmo critério do catálogo interno do cliente.
   */
  private async produtosDoCliente(
    empresaId: number,
    cliente: { id: number; grupo: string | null },
  ) {
    const ors: Array<Record<string, unknown>> = [{ clienteId: cliente.id }];
    if (cliente.grupo && cliente.grupo.trim()) {
      ors.push({ clienteGrupo: cliente.grupo.trim() });
    }
    return this.prisma.produto.findMany({
      where: { empresaId, OR: ors },
      select: {
        id: true,
        codigo: true,
        descricao: true,
        cor: true,
        setor: true,
        grade: true,
      },
      orderBy: { descricao: 'asc' },
    });
  }

  /**
   * Saldo pronta-entrega por produto/tamanho, contado peça a peça em UnidadeEstoque
   * (a etiqueta é a unidade física). É a MESMA fonte da ficha do cliente no ERP —
   * a tabela `Estoque` agregada está vazia e não reflete o estoque real.
   * `reservado` entra junto com `em_estoque`: a peça já está pronta e separada para
   * este cliente. `despachado` e `aguardando_endereco` ficam de fora.
   */
  private async saldoPronta(empresaId: number, produtoIds: number[]) {
    const saldos = new Map<number, Map<string, number>>();
    if (!produtoIds.length) return saldos;
    const unidades = await this.prisma.unidadeEstoque.findMany({
      where: { empresaId, produtoId: { in: produtoIds }, status: { in: ['em_estoque', 'reservado'] } },
      select: { produtoId: true, tamanho: true },
      take: 200_000,
    });
    for (const u of unidades) {
      if (u.produtoId == null) continue;
      const porTam = saldos.get(u.produtoId) ?? new Map<string, number>();
      const t = String(u.tamanho || '—').toUpperCase().trim() || '—';
      porTam.set(t, (porTam.get(t) ?? 0) + 1);
      saldos.set(u.produtoId, porTam);
    }
    return saldos;
  }

  /** Estoque pronta-entrega do cliente: peças prontas, por produto/tamanho. */
  async estoque(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const produtos = await this.produtosDoCliente(user.empresaId, cliente);
    const saldos = await this.saldoPronta(user.empresaId, produtos.map((p) => p.id));

    const rankTam = PortalService.rankTam;

    const itens = produtos
      .map((p) => {
        const tamanhos = [...(saldos.get(p.id) ?? new Map<string, number>()).entries()]
          .map(([tamanho, saldo]) => ({ tamanho, saldo }))
          .filter((t) => t.saldo > 0)
          .sort((a, b) => rankTam(a.tamanho) - rankTam(b.tamanho) || a.tamanho.localeCompare(b.tamanho));
        const total = tamanhos.reduce((s, t) => s + t.saldo, 0);
        return {
          produtoId: p.id,
          codigo: p.codigo,
          descricao: p.descricao,
          cor: p.cor,
          setor: p.setor,
          tamanhos,
          total,
        };
      })
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);

    const totalPecas = itens.reduce((s, p) => s + p.total, 0);
    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      totalItens: itens.length,
      totalPecas,
      itens,
    };
  }

  /** Andamento e prazos dos pedidos do cliente (fora orçamentos e cancelados). */
  async producao(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);

    const pedidos = await this.prisma.pedido.findMany({
      where: {
        clienteId: cliente.id,
        empresaId: user.empresaId,
        // Orçamentos internos ficam fora; os do PORTAL entram (o cliente precisa ver o
        // pedido que acabou de enviar, como "Aguardando validação").
        AND: [{ etapa: { not: 'cancelado' } }, { OR: [{ etapa: { not: 'orcamento' } }, { origem: 'portal' }] }],
      },
      select: {
        id: true,
        numero: true,
        data: true,
        prazoEntrega: true,
        etapa: true,
        ordemCompraCliente: true,
        clienteUnidadeId: true,
        itens: { select: { descricao: true, cor: true, quantidade: true, quantidadeExpedida: true } },
        ops: { select: { status: true, progresso: true, entregaPrev: true, quantidade: true } },
      },
      orderBy: { data: 'desc' },
    });

    const ETAPA: Record<string, { label: string; passo: number }> = {
      orcamento: { label: 'Aguardando validação', passo: 0 }, // só pedidos do portal chegam aqui
      aprovado: { label: 'Pedido aprovado', passo: 1 },
      piloto: { label: 'Aprovação da peça-piloto', passo: 2 },
      material: { label: 'Separação de material', passo: 3 },
      compra: { label: 'Compra de insumos', passo: 3 },
      producao: { label: 'Em produção', passo: 4 },
      estoque: { label: 'Pronto — em estoque', passo: 5 },
      expedicao: { label: 'Em expedição', passo: 6 },
      parcial: { label: 'Entregue parcial', passo: 6 },
      concluido: { label: 'Entregue', passo: 7 },
    };
    const TOTAL_PASSOS = 7;
    const hoje = new Date();
    // Nome da unidade destinatária de cada pedido (quando houver).
    const uniIds = [...new Set(pedidos.map((p) => p.clienteUnidadeId).filter((x): x is number => x != null))];
    const uniNome = new Map(
      (uniIds.length ? await this.prisma.clienteUnidade.findMany({ where: { id: { in: uniIds } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]),
    );

    const lista = pedidos.map((p) => {
      const meta = ETAPA[p.etapa] || { label: p.etapa, passo: 1 };
      // Progresso: média das OPs quando há produção; senão pelo passo da etapa.
      let progresso = Math.round((meta.passo / TOTAL_PASSOS) * 100);
      if (p.ops.length && meta.passo >= 4 && meta.passo < 7) {
        const media = p.ops.reduce((s, o) => s + (o.progresso || 0), 0) / p.ops.length;
        progresso = Math.max(progresso, Math.round(media));
      }
      if (p.etapa === 'concluido') progresso = 100;

      const totalPecas = p.itens.reduce((s, i) => s + (i.quantidade || 0), 0);
      const expedidas = p.itens.reduce((s, i) => s + (i.quantidadeExpedida || 0), 0);
      const prazo = p.prazoEntrega || p.ops.map((o) => o.entregaPrev).filter(Boolean).sort()[0] || null;
      const atrasado = !!prazo && p.etapa !== 'concluido' && new Date(prazo) < hoje;

      return {
        pedidoId: p.id,
        numero: p.numero,
        data: p.data,
        ordemCompraCliente: p.ordemCompraCliente,
        unidade: p.clienteUnidadeId != null ? uniNome.get(p.clienteUnidadeId) ?? null : null,
        etapa: p.etapa,
        etapaLabel: meta.label,
        progresso,
        prazoEntrega: prazo,
        atrasado,
        totalPecas,
        expedidas,
        itens: p.itens.map((i) => ({
          descricao: i.descricao,
          cor: i.cor,
          quantidade: i.quantidade,
          expedida: i.quantidadeExpedida,
        })),
      };
    });

    const emAndamento = lista.filter((p) => p.etapa !== 'concluido').length;
    const atrasados = lista.filter((p) => p.atrasado).length;
    const proximaEntrega =
      lista
        .filter((p) => p.prazoEntrega && p.etapa !== 'concluido')
        .map((p) => p.prazoEntrega as Date)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;

    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      resumo: { total: lista.length, emAndamento, atrasados, proximaEntrega },
      pedidos: lista,
    };
  }

  /** KPIs do topo do portal (estoque + produção num só request). */
  async resumo(user: AuthUser, override?: number) {
    const [est, prod] = await Promise.all([
      this.estoque(user, override),
      this.producao(user, override),
    ]);
    return {
      cliente: est.cliente,
      estoque: { itens: est.totalItens, pecas: est.totalPecas },
      producao: prod.resumo,
    };
  }

  /** Notas fiscais de VENDA (faturamento) emitidas para o cliente — PDF/XML quando reais (Focus). */
  async notas(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const pedidos = await this.prisma.pedido.findMany({
      where: { clienteId: cliente.id, empresaId: user.empresaId },
      select: { id: true, numero: true },
    });
    const numById = new Map(pedidos.map((p) => [p.id, p.numero]));
    const pedidoIds = pedidos.map((p) => p.id);

    const notas = pedidoIds.length
      ? await this.prisma.notaFiscal.findMany({
          where: {
            empresaId: user.empresaId,
            tipo: 'venda',
            status: { in: ['autorizada', 'cancelada'] },
            pedidoId: { in: pedidoIds },
          },
          select: {
            id: true, numero: true, serie: true, chave: true, valor: true,
            emitidaEm: true, status: true, provedor: true, pedidoId: true,
            ordemCompraCliente: true,
          },
          orderBy: { emitidaEm: 'desc' },
        })
      : [];

    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      notas: notas.map((n) => ({
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        chave: n.chave,
        valor: n.valor,
        emitidaEm: n.emitidaEm,
        status: n.status,
        pedido: n.pedidoId ? numById.get(n.pedidoId) ?? null : null,
        ordemCompraCliente: n.ordemCompraCliente,
        // PDF/XML só existem para nota REAL (Focus) e autorizada.
        arquivos: n.provedor === 'focusnfe' && n.status === 'autorizada',
      })),
    };
  }

  /**
   * Baixa DANFE/XML de UMA nota do cliente. TRAVA de escopo: a nota tem que ser de VENDA
   * e pertencer a um pedido do próprio cliente (impede baixar a NF de outro cliente pelo id).
   */
  async baixarNota(user: AuthUser, notaId: number, tipo: 'danfe' | 'xml', override?: number, ip?: string) {
    const cliente = await this.clienteDoEscopo(user, override);
    const nota = await this.prisma.notaFiscal.findFirst({
      where: { id: notaId, empresaId: user.empresaId, tipo: 'venda' },
      select: { id: true, pedidoId: true, numero: true, chave: true },
    });
    if (!nota || !nota.pedidoId) throw new ForbiddenException('Nota não encontrada.');
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: nota.pedidoId, clienteId: cliente.id, empresaId: user.empresaId },
      select: { id: true, numero: true },
    });
    if (!pedido) throw new ForbiddenException('Esta nota não pertence ao seu cadastro.');
    const arq = await this.nfe.baixarArquivo(notaId, user.empresaId, tipo);
    // ASSINATURA do download: o AuditInterceptor só audita escrita, e baixar NF é GET.
    // Registra só quando o arquivo saiu de fato (erro da Focus não vira "download").
    void this.logs.registrar({
      usuario: this.quemAssina(user),
      acao: `portal: baixou ${tipo === 'danfe' ? 'PDF (DANFE)' : 'XML'} da NF`,
      detalhe: `NF ${nota.numero} · pedido ${pedido.numero} · cliente ${cliente.fantasia || cliente.nome}${nota.chave ? ` · chave ${nota.chave}` : ''}`,
      entidade: 'nota_fiscal', entidadeId: nota.id, ip,
    });
    return arq;
  }

  // Escala da casa (é a ordem usada no cadastro de produto): o GG fica entre o G e o G1.
  private static readonly ORDEM_TAM = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'XG', 'EXG', 'U', 'UNICO'];
  /** Ordem visual dos tamanhos (PP…G8, depois o resto em ordem alfabética). */
  static rankTam(t: string): number {
    const i = PortalService.ORDEM_TAM.indexOf(String(t || '').toUpperCase());
    return i < 0 ? 999 : i;
  }

  /**
   * Tamanhos declarados na GRADE do produto (texto livre do cadastro). Aceita faixa
   * ("PP ao G8", "P a G4", "M-G2"), lista ("P, M, G" ou "P:10, M:20") e tamanho único.
   */
  static tamanhosDaGrade(grade?: string | null): string[] {
    const t = String(grade ?? '').toUpperCase().trim();
    if (!t) return [];
    const faixa = /^([A-Z]{1,2}\d?)\s*(?:AO|ATÉ|ATE|A|-|–|—)\s*([A-Z]{1,2}\d?)$/.exec(t);
    if (faixa) {
      const i = PortalService.ORDEM_TAM.indexOf(faixa[1]);
      const j = PortalService.ORDEM_TAM.indexOf(faixa[2]);
      if (i >= 0 && j >= i) return PortalService.ORDEM_TAM.slice(i, j + 1);
    }
    const lista = t.split(/[,;/]+/).map((s) => s.split(':')[0].trim()).filter((s) => /^[A-Z0-9]{1,5}$/.test(s));
    return [...new Set(lista)];
  }

  /**
   * Tamanhos que o cliente pode pedir: os que têm linha de estoque (com o saldo) MAIS os
   * da grade do produto (saldo 0 — produzidos sob encomenda). Sem isso, produto sem
   * estoque cadastrado aparecia sem escolha de tamanho no Novo pedido.
   */
  static tamanhosDoProduto(
    saldos?: Map<string, number> | null,
    grade?: string | null,
  ): Array<{ tamanho: string; saldo: number }> {
    const mapa = new Map<string, number>();
    for (const t of PortalService.tamanhosDaGrade(grade)) mapa.set(t, 0);
    for (const [tam, qtd] of saldos ?? []) {
      const t = String(tam || '').toUpperCase();
      if (t && t !== '—') mapa.set(t, Math.max(0, qtd || 0));
    }
    return [...mapa.entries()]
      .map(([tamanho, saldo]) => ({ tamanho, saldo }))
      .sort((a, b) => PortalService.rankTam(a.tamanho) - PortalService.rankTam(b.tamanho) || a.tamanho.localeCompare(b.tamanho, 'pt', { numeric: true }));
  }

  /**
   * Catálogo "Disponível para compra": produtos do cliente (mesmo critério do estoque) +
   * produtos dos contratos ativos dele. O PREÇO é resolvido AQUI, no servidor: preço do
   * contrato quando existir; senão o preço de venda do próprio ERP (precoBase/precoEspecial,
   * o mesmo que vai nos pedidos e na NF). Nunca uma tabela genérica do front — evita
   * divergência entre o portal e a nota fiscal. Disponibilidade = saldo por tamanho
   * (inclui tamanhos com saldo zero, que podem ser encomendados); prazo = pronta entrega
   * quando há saldo, senão o prazo de produção do contrato.
   */
  async catalogo(user: AuthUser, override?: number, unidadeId?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const empresaId = user.empresaId;
    const unidade = await this.unidadeDoCliente(cliente.id, unidadeId);

    // Contratos vigentes do cliente. Com UNIDADE escolhida: só os dela + os gerais (sem
    // unidade), e o específico da unidade tem prioridade sobre o geral no preço.
    const contratosRaw = await this.prisma.contrato.findMany({
      where: {
        empresaId, clienteId: cliente.id, ativo: true,
        AND: [
          { OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }] },
          ...(unidade ? [{ OR: [{ clienteUnidadeId: null }, { clienteUnidadeId: unidade.id }] }] : []),
        ],
      },
      include: { itens: { select: { produtoId: true, preco: true, unidade: true } } },
      orderBy: { id: 'desc' },
    });
    const contratos = unidade
      ? [...contratosRaw].sort((a, b) => (b.clienteUnidadeId ? 1 : 0) - (a.clienteUnidadeId ? 1 : 0) || b.id - a.id)
      : contratosRaw;
    // Primeiro contrato (mais recente) que tabela o produto vence.
    const precoContrato = new Map<number, { preco: Prisma.Decimal; unidade: string | null }>();
    for (const c of contratos) {
      for (const it of c.itens) {
        if (it.produtoId != null && !precoContrato.has(it.produtoId)) {
          precoContrato.set(it.produtoId, { preco: it.preco, unidade: it.unidade });
        }
      }
    }
    const contratoRef = contratos[0] ?? null;
    const prazoContrato = (() => {
      const p = (contratoRef?.prazoEntrega || '').trim();
      if (!p) return null;
      return /^\d+$/.test(p) ? `${p} dias` : p; // "30" -> "30 dias"; "10 dias úteis" fica como está
    })();

    const ors: Array<Record<string, unknown>> = [{ clienteId: cliente.id }];
    if (cliente.grupo && cliente.grupo.trim()) ors.push({ clienteGrupo: cliente.grupo.trim() });
    const idsContrato = [...precoContrato.keys()];
    if (idsContrato.length) ors.push({ id: { in: idsContrato } });

    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, OR: ors },
      select: {
        id: true, codigo: true, descricao: true, cor: true, setor: true, grade: true,
        precoBase: true, precoEspecial: true, tamsEspeciais: true,
      },
      orderBy: { descricao: 'asc' },
    });
    const saldos = await this.saldoPronta(empresaId, produtos.map((p) => p.id));

    const itens = produtos
      .map((p) => {
        const tamanhos = PortalService.tamanhosDoProduto(saldos.get(p.id), p.grade);
        const disponivel = tamanhos.reduce((s, t) => s + t.saldo, 0);
        const ctr = precoContrato.get(p.id);
        // A faixa de tamanhos grandes (G1…G8) é do PRODUTO e vale TAMBÉM quando o preço vem
        // do contrato: é assim que o pedido é somado (PedidosService.precoTamanho). Se o
        // portal escondesse a faixa, mostraria barato e faturaria caro.
        const tamsEsp = PedidosService.tamsEspeciais(p as unknown as Produto);
        const especial = p.precoEspecial != null && tamsEsp.length ? p.precoEspecial : null;
        return {
          produtoId: p.id,
          sku: p.codigo,
          descricao: p.descricao,
          cor: p.cor,
          setor: p.setor,
          unidade: ctr?.unidade || 'un',
          preco: ctr ? ctr.preco : p.precoBase,
          precoEspecial: especial,
          tamsEspeciais: especial ? tamsEsp : [],
          precoOrigem: ctr ? 'contrato' : p.precoBase != null ? 'tabela' : null,
          tamanhos,
          disponivel,
          prazo: disponivel > 0 ? 'Pronta entrega' : prazoContrato || 'Sob encomenda',
        };
      })
      .sort((a, b) => b.disponivel - a.disponivel || a.descricao.localeCompare(b.descricao));

    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      unidade: unidade ? { id: unidade.id, nome: unidade.nome } : null,
      contrato: contratoRef
        ? {
            numero: contratoRef.numero,
            filialId: contratoRef.filialId, // CNPJ emissor do contrato (usado ao criar o pedido)
            prazoEntrega: prazoContrato,
            condicaoPagamento: contratoRef.condicaoPagamento,
            formaPagamento: contratoRef.formaPagamento,
          }
        : null,
      totalItens: itens.length,
      itens,
    };
  }

  /**
   * Pedido enviado pelo PORTAL DO CLIENTE (carrinho). Nasce no ERP como pedido em
   * `etapa=orcamento` — o portão de validação: a equipe APROVA (fluxo normal) e ele entra
   * em produção/expedição — com status "Portal — aguardando validação", origem='portal'
   * e chave de idempotência (duplo clique/retry devolve o mesmo pedido). O PREÇO vem do
   * catálogo (servidor), nunca do front. Estoque NÃO bloqueia (o que faltar vai para
   * produção), mas o excedente é registrado para a equipe. Gera alerta no ERP (vendas)
   * e e-mail de aviso ao contato da empresa.
   */
  async criarPedido(user: AuthUser, dto: CriarPedidoPortalDto, override?: number, ip?: string) {
    const cliente = await this.clienteDoEscopo(user, override);
    const empresaId = user.empresaId;
    const chave = dto.chaveIdempotencia.trim();

    const existente = await this.prisma.pedido.findFirst({
      where: { portalChave: chave, empresaId, clienteId: cliente.id },
      include: { itens: true },
    });
    if (existente) return this.respostaPedido(existente, true);

    // "Contrato primeiro": o pedido nasce de UM contrato do cliente — a unidade, a empresa
    // emissora e os PREÇOS vêm dele (inclusive itens sem produto vinculado). Sem contrato
    // (produtos fora de contrato / tabela), usa o catálogo.
    const contrato = dto.contratoId ? await this.contratoDoCliente(cliente.id, empresaId, dto.contratoId) : null;
    const unidade = contrato ? contrato.clienteUnidade : await this.unidadeDoCliente(cliente.id, dto.unidadeId);
    const cat = contrato ? null : await this.catalogo(user, override, unidade?.id);
    const porProduto = new Map((cat?.itens ?? []).map((i) => [i.produtoId, i]));
    const itens: CreatePedidoDto['itens'] = [];
    const acimaDoSaldo: string[] = [];
    for (const it of dto.itens) {
      let c: { produtoId: number | null; sku: string | null; descricao: string; cor: string | null; preco: Prisma.Decimal | null; tamanhos: Array<{ tamanho: string; saldo: number }>; disponivel: number };
      if (contrato) {
        const ci = contrato.itens.find((x) =>
          it.contratoItemId != null ? x.id === it.contratoItemId : it.produtoId != null && x.produtoId === it.produtoId,
        );
        if (!ci) throw new BadRequestException(`Item não faz parte do contrato ${contrato.numero || '#' + contrato.id}.`);
        const tamanhos = PortalService.tamanhosDoProduto(
          ci.produtoId != null ? contrato.saldos.get(ci.produtoId) : null,
          ci.produto?.grade,
        );
        c = {
          produtoId: ci.produtoId, sku: ci.produto?.codigo ?? ci.codigo, descricao: ci.descricao, cor: ci.produto?.cor ?? null,
          preco: ci.preco, tamanhos, disponivel: tamanhos.reduce((s, t) => s + t.saldo, 0),
        };
      } else {
        const k = it.produtoId != null ? porProduto.get(it.produtoId) : undefined;
        if (!k) throw new BadRequestException(`Produto ${it.produtoId ?? '?'} não está no seu catálogo.`);
        c = { produtoId: k.produtoId, sku: k.sku, descricao: k.descricao, cor: k.cor, preco: k.preco, tamanhos: k.tamanhos, disponivel: k.disponivel };
      }
      if (c.preco == null) {
        throw new BadRequestException(`"${c.descricao}" está sob consulta — fale com seu consultor para incluir no pedido.`);
      }
      const grade: Record<string, number> = {};
      let total = 0;
      for (const [t, q] of Object.entries(it.grade ?? {})) {
        const n = Math.round(Number(q));
        if (t && Number.isFinite(n) && n > 0) {
          grade[String(t).toUpperCase()] = n;
          total += n;
        }
      }
      if (!total && it.quantidade && it.quantidade > 0) total = Math.round(it.quantidade);
      if (!total) throw new BadRequestException(`Informe a quantidade de "${c.descricao}".`);

      const saldoTam = new Map(c.tamanhos.map((t) => [t.tamanho.toUpperCase(), t.saldo]));
      const excedentes = Object.entries(grade)
        .filter(([t, q]) => q > (saldoTam.get(t) ?? 0))
        .map(([t, q]) => `${t}: ${q} (saldo ${saldoTam.get(t) ?? 0})`);
      if (Object.keys(grade).length ? excedentes.length > 0 : total > c.disponivel) {
        acimaDoSaldo.push(`${c.sku ?? ''} ${c.descricao}${excedentes.length ? ' — ' + excedentes.join(', ') : ` — ${total} (saldo ${c.disponivel})`}`.trim());
      }
      itens.push({
        produtoId: c.produtoId ?? undefined,
        descricao: c.descricao,
        cor: c.cor ?? undefined,
        quantidade: total,
        valorUnit: Number(c.preco), // faixa especial por tamanho é aplicada pelo PedidosService
        grade: Object.keys(grade).length ? grade : undefined,
      });
    }

    const quem = (user.nome || user.usuario || 'cliente').toString();
    const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const nomeCli = cliente.fantasia || cliente.nome;
    const obsCliente = dto.observacao?.trim() || '';
    const rotuloContrato = contrato ? contrato.numero || contrato.descricao || `#${contrato.id}` : null;
    const obsPartes = [`Pedido enviado pelo PORTAL DO CLIENTE em ${quando} por ${quem}${rotuloContrato ? ` — contrato ${rotuloContrato}` : ''}${unidade ? ` — unidade: ${unidade.nome}` : ''}.`];
    if (obsCliente) obsPartes.push(`Obs. do cliente: ${obsCliente}`);
    if (acimaDoSaldo.length) obsPartes.push(`Acima do saldo (vai p/ produção): ${acimaDoSaldo.join(' | ')}`);

    let criado: { id: number };
    try {
      criado = await this.pedidos.create(
        {
          clienteId: cliente.id,
          clienteUnidadeId: unidade?.id ?? undefined,
          filialId: (contrato ? contrato.filialId : cat?.contrato?.filialId) ?? undefined,
          itens,
          formaPagamento:
            (contrato ? contrato.condicaoPagamento || contrato.formaPagamento : cat?.contrato?.condicaoPagamento || cat?.contrato?.formaPagamento) || undefined,
          obsComercial: obsPartes.join('\n').slice(0, 5000),
        } as CreatePedidoDto,
        empresaId,
        `portal:${quem}`.slice(0, 80),
      );
    } catch (e) {
      if (e instanceof ConflictException) {
        // Restrição de crédito: NÃO expõe o motivo ao cliente; avisa a equipe (alerta + e-mail).
        const motivo = (e as Error).message;
        await this.notificacoes.criar(empresaId, {
          tipo: 'pedido_novo',
          areas: ['vendas', 'receber'],
          titulo: `Pedido do PORTAL bloqueado — ${nomeCli}`,
          mensagem: `O cliente tentou enviar um pedido pelo portal e o ERP bloqueou: ${motivo}`,
        });
        void this.avisarEmail(
          `[Portal] Pedido BLOQUEADO — ${nomeCli}`,
          `O cliente ${nomeCli} tentou enviar um pedido pelo Portal do Cliente em ${quando} (por ${quem}) e o ERP bloqueou:\n${motivo}\n\nItens: ${itens.map((i) => `${i.descricao} × ${i.quantidade}`).join('; ')}`,
        );
        throw new BadRequestException('Seu pedido não pôde ser registrado automaticamente. Nossa equipe comercial foi avisada e entrará em contato.');
      }
      throw e;
    }

    const pedido = await this.prisma.pedido.update({
      where: { id: criado.id },
      data: { origem: 'portal', portalChave: chave, status: 'Portal — aguardando validação' },
      include: { itens: true },
    });
    const totalPecas = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
    const valor = new Prisma.Decimal(pedido.valorTotal).toFixed(2);

    // ASSINATURA do pedido: o interceptor já audita o POST, mas sem detalhe legível.
    void this.logs.registrar({
      usuario: this.quemAssina(user),
      acao: 'portal: enviou pedido de reposição',
      detalhe: `Pedido ${pedido.numero} · ${totalPecas} peça(s) · R$ ${valor} · cliente ${nomeCli}${rotuloContrato ? ` · contrato ${rotuloContrato}` : ''}${unidade ? ` · unidade ${unidade.nome}` : ''}`,
      entidade: 'pedido', entidadeId: pedido.id, ip,
    });

    await this.notificacoes.criar(empresaId, {
      tipo: 'pedido_novo',
      areas: ['vendas'],
      titulo: `Novo pedido do PORTAL ${pedido.numero} — ${nomeCli}`,
      mensagem: `${totalPecas} peça(s) · R$ ${valor} · enviado por ${quem}${rotuloContrato ? ` · contrato ${rotuloContrato}` : ''}${unidade ? ` · unidade ${unidade.nome}` : ''}. VALIDE o pedido (aprovar) para entrar no fluxo.${acimaDoSaldo.length ? ' Há itens acima do saldo (vão para produção).' : ''}`,
      refTipo: 'pedido',
      refId: pedido.id,
    });

    const linhas = pedido.itens.map((i) => {
      const g = i.grade && typeof i.grade === 'object' ? Object.entries(i.grade as Record<string, number>).map(([t, q]) => `${t}:${q}`).join(' ') : '';
      return `- ${i.descricao}${i.cor ? ' · ' + i.cor : ''}: ${i.quantidade} un${g ? ` (${g})` : ''} × R$ ${new Prisma.Decimal(i.valorUnit).toFixed(2)}`;
    });
    // O comprador recebe cópia do próprio pedido: ele fica com o mesmo registro que nós.
    // O e-mail é gravado no login dele, então das próximas vezes já vem preenchido.
    const emailComprador = String(dto.email || '').trim().toLowerCase();
    if (emailComprador && user.sub) {
      await this.prisma.usuario
        .update({ where: { id: user.sub }, data: { email: emailComprador } })
        .catch((e) => this.logger.warn(`Não consegui gravar o e-mail do comprador: ${(e as Error).message}`));
    }

    void this.avisarEmail(
      `[Portal] Novo pedido ${pedido.numero} — ${nomeCli}`,
      [
        'Novo pedido enviado pelo Portal do Cliente.',
        '',
        `Cliente: ${nomeCli}`,
        unidade ? `Unidade: ${unidade.nome}${unidade.cnpjCpf ? ' (' + unidade.cnpjCpf + ')' : ''}` : null,
        rotuloContrato ? `Contrato: ${rotuloContrato}` : null,
        `Pedido: ${pedido.numero}`,
        `Enviado por: ${quem} em ${quando}`,
        `Total: ${totalPecas} peça(s) · R$ ${valor}`,
        '',
        'Itens:',
        ...linhas,
        obsCliente ? `\nObservação do cliente: ${obsCliente}` : null,
        acimaDoSaldo.length ? `\nAtenção — acima do saldo (vai p/ produção): ${acimaDoSaldo.join(' | ')}` : null,
        '',
        'O pedido está no ERP como "Portal — aguardando validação". Aprove-o para entrar no fluxo.',
      ].filter((l) => l !== null).join('\n'),
      emailComprador || undefined,
    );

    return this.respostaPedido(pedido, false);
  }

  /** Valida que a unidade pertence ao cliente do escopo (sem unidade => null). */
  private async unidadeDoCliente(clienteId: number, unidadeId?: number | null) {
    if (!unidadeId) return null;
    const u = await this.prisma.clienteUnidade.findFirst({
      where: { id: unidadeId, clienteId },
      select: { id: true, nome: true, cnpjCpf: true, municipio: true, uf: true },
    });
    if (!u) throw new BadRequestException('Unidade não encontrada para este cliente.');
    return u;
  }

  /** Unidades do cliente (seletor do portal) + quantos contratos vigentes cada uma tem. */
  async unidades(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const [unidades, contratos] = await Promise.all([
      this.prisma.clienteUnidade.findMany({
        where: { clienteId: cliente.id },
        select: { id: true, nome: true, cnpjCpf: true, municipio: true, uf: true },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.contrato.findMany({
        where: { empresaId: user.empresaId, clienteId: cliente.id, ativo: true, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }] },
        select: { clienteUnidadeId: true },
      }),
    ]);
    const porUnidade = new Map<number, number>();
    let gerais = 0;
    for (const c of contratos) {
      if (c.clienteUnidadeId) porUnidade.set(c.clienteUnidadeId, (porUnidade.get(c.clienteUnidadeId) ?? 0) + 1);
      else gerais++;
    }
    return {
      cliente: { nome: cliente.fantasia || cliente.nome },
      contratosGerais: gerais,
      unidades: unidades.map((u) => ({ ...u, contratos: porUnidade.get(u.id) ?? 0 })),
    };
  }

  /** Contrato vigente do cliente com itens + produto (estoque) + unidade — base do pedido "contrato primeiro". */
  private async contratoDoCliente(clienteId: number, empresaId: number, contratoId: number) {
    const c = await this.prisma.contrato.findFirst({
      where: { id: contratoId, empresaId, clienteId, ativo: true, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }] },
      include: {
        clienteUnidade: { select: { id: true, nome: true, cnpjCpf: true, municipio: true, uf: true } },
        itens: {
          orderBy: { id: 'asc' },
          include: { produto: { select: { id: true, codigo: true, descricao: true, cor: true, grade: true, precoEspecial: true, tamsEspeciais: true } } },
        },
      },
    });
    if (!c) throw new BadRequestException('Contrato não encontrado (ou fora de vigência) para este cliente.');
    // Saldo pronta-entrega dos produtos do contrato — mesma fonte do resto do portal.
    const saldos = await this.saldoPronta(empresaId, c.itens.map((i) => i.produtoId).filter((x): x is number => x != null));
    return { ...c, saldos };
  }

  /**
   * Contratos vigentes do cliente COM os itens (fluxo "contrato primeiro" do Novo pedido e o
   * catálogo agrupado) + "outros": produtos do cadastro do cliente que não estão em nenhum
   * contrato (preço de tabela do ERP). Item de contrato sem produto vinculado também aparece
   * (é pedível: descrição + preço do contrato). `temFoto` evita mandar o base64 na lista.
   */
  async contratos(user: AuthUser, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const empresaId = user.empresaId;
    const selProduto = {
      id: true, codigo: true, descricao: true, cor: true, setor: true, grade: true, precoBase: true, precoEspecial: true, tamsEspeciais: true,
      estoque: { select: { tamanho: true, entradas: true, saidas: true } },
    } as const;

    const contratosRaw = await this.prisma.contrato.findMany({
      where: { empresaId, clienteId: cliente.id, ativo: true, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }] },
      include: {
        clienteUnidade: { select: { id: true, nome: true, municipio: true, uf: true } },
        filial: { select: { id: true, nome: true } },
        itens: { orderBy: { id: 'asc' }, include: { produto: { select: selProduto } } },
      },
      orderBy: { id: 'asc' },
    });
    const ors: Array<Record<string, unknown>> = [{ clienteId: cliente.id }];
    if (cliente.grupo && cliente.grupo.trim()) ors.push({ clienteGrupo: cliente.grupo.trim() });
    const produtos = await this.prisma.produto.findMany({ where: { empresaId, OR: ors }, select: selProduto, orderBy: { descricao: 'asc' } });

    const idsProd = new Set<number>(produtos.map((p) => p.id));
    for (const c of contratosRaw) for (const it of c.itens) if (it.produtoId != null) idsProd.add(it.produtoId);
    const comFoto = new Set(
      idsProd.size
        ? (await this.prisma.$queryRaw<{ id: number }[]>`SELECT id FROM "Produto" WHERE id IN (${Prisma.join([...idsProd])}) AND "fotoModelo" IS NOT NULL AND length("fotoModelo") > 0`).map((r) => r.id)
        : [],
    );
    // Saldo pronta-entrega de tudo que aparece nesta tela (itens de contrato + produtos soltos).
    const saldos = await this.saldoPronta(empresaId, [...new Set([...idsProd, ...produtos.map((p) => p.id)])]);
    const tamanhosDe = (produtoId?: number | null, grade?: string | null) =>
      PortalService.tamanhosDoProduto(produtoId != null ? saldos.get(produtoId) : null, grade);
    const prazoDe = (p?: string | null) => { const s = (p || '').trim(); return s ? (/^\d+$/.test(s) ? `${s} dias` : s) : null; };

    const emContrato = new Set<number>();
    const contratos = contratosRaw.map((c) => {
      const prazoC = prazoDe(c.prazoEntrega);
      return {
        id: c.id,
        numero: c.numero,
        descricao: c.descricao,
        unidade: c.clienteUnidade ? { id: c.clienteUnidade.id, nome: c.clienteUnidade.nome, municipio: c.clienteUnidade.municipio, uf: c.clienteUnidade.uf } : null,
        filial: c.filial ? { id: c.filial.id, nome: c.filial.nome } : null,
        prazoEntrega: prazoC,
        condicaoPagamento: c.condicaoPagamento,
        formaPagamento: c.formaPagamento,
        itens: c.itens.map((it) => {
          const p = it.produto;
          if (p) emContrato.add(p.id);
          const tamanhos = tamanhosDe(p?.id, p?.grade);
          const disponivel = tamanhos.reduce((s, t) => s + t.saldo, 0);
          // Mesma regra do catálogo: a faixa de tamanhos grandes vem do produto e continua
          // valendo sobre o preço de contrato (é o que o pedido vai cobrar).
          const tamsEsp = p ? PedidosService.tamsEspeciais(p as unknown as Produto) : [];
          const especial = p?.precoEspecial != null && tamsEsp.length ? p.precoEspecial : null;
          return {
            contratoItemId: it.id,
            produtoId: p?.id ?? null,
            sku: p?.codigo ?? it.codigo ?? null,
            descricao: it.descricao,
            cor: p?.cor ?? null,
            unidade: it.unidade || 'un',
            preco: it.preco,
            precoEspecial: especial,
            tamsEspeciais: especial ? tamsEsp : [],
            precoOrigem: 'contrato' as const,
            temFoto: !!(p && comFoto.has(p.id)),
            tamanhos,
            disponivel,
            prazo: disponivel > 0 ? 'Pronta entrega' : prazoC || 'Sob encomenda',
          };
        }),
      };
    });
    const outros = produtos
      .filter((p) => !emContrato.has(p.id))
      .map((p) => {
        const tamanhos = tamanhosDe(p.id, p.grade);
        const disponivel = tamanhos.reduce((s, t) => s + t.saldo, 0);
        const tamsEsp = PedidosService.tamsEspeciais(p as unknown as Produto);
        return {
          contratoItemId: null as number | null,
          produtoId: p.id,
          sku: p.codigo,
          descricao: p.descricao,
          cor: p.cor,
          unidade: 'un',
          preco: p.precoBase,
          precoEspecial: p.precoEspecial != null && tamsEsp.length ? p.precoEspecial : null,
          tamsEspeciais: tamsEsp,
          precoOrigem: (p.precoBase != null ? 'tabela' : null) as 'tabela' | null,
          temFoto: comFoto.has(p.id),
          tamanhos,
          disponivel,
          prazo: disponivel > 0 ? 'Pronta entrega' : 'Sob encomenda',
        };
      });

    return { cliente: { nome: cliente.fantasia || cliente.nome }, contratos, outros };
  }

  /** Foto do produto (data URI em Produto.fotoModelo) — só se o produto é do catálogo/contratos do cliente. */
  async fotoProduto(user: AuthUser, produtoId: number, override?: number) {
    const cliente = await this.clienteDoEscopo(user, override);
    const p = await this.prisma.produto.findFirst({
      where: { id: produtoId, empresaId: user.empresaId },
      select: { id: true, clienteId: true, clienteGrupo: true, fotoModelo: true },
    });
    if (!p) throw new NotFoundException('Produto não encontrado.');
    const meu =
      p.clienteId === cliente.id ||
      (!!cliente.grupo && !!cliente.grupo.trim() && p.clienteGrupo === cliente.grupo.trim()) ||
      !!(await this.prisma.contratoItem.findFirst({ where: { produtoId, contrato: { clienteId: cliente.id, empresaId: user.empresaId } }, select: { id: true } }));
    if (!meu) throw new ForbiddenException('Produto fora do seu catálogo.');
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(p.fotoModelo || '');
    if (!m) throw new NotFoundException('Produto sem foto.');
    return { contentType: m[1], content: Buffer.from(m[2], 'base64') };
  }

  private respostaPedido(
    p: { numero: string; status: string; valorTotal: Prisma.Decimal; itens: Array<{ descricao: string; cor: string | null; quantidade: number; valorUnit: Prisma.Decimal; grade: unknown }> },
    repetido: boolean,
  ) {
    return {
      numero: p.numero,
      status: p.status,
      valorTotal: p.valorTotal,
      totalPecas: p.itens.reduce((s, i) => s + i.quantidade, 0),
      itens: p.itens.map((i) => ({ descricao: i.descricao, cor: i.cor, quantidade: i.quantidade, valorUnit: i.valorUnit, grade: i.grade })),
      repetido, // true = este envio já tinha sido registrado (duplicidade ignorada)
    };
  }

  /** E-mail de aviso ao contato da empresa (env PORTAL_AVISO_EMAIL). Nunca derruba o pedido. */
  private async avisarEmail(assunto: string, texto: string, cc?: string) {
    const para = (this.config.get<string>('PORTAL_AVISO_EMAIL') || 'contato@hcqualitycorp.com.br').trim();
    try {
      const r = await this.email.enviar({ para, cc, assunto, texto, remetenteNome: 'Portal do Cliente — HC Quality' });
      this.logger.log(`Aviso do portal "${assunto}" -> ${para}${cc ? ` (cc ${cc})` : ''}: ${r.enviado ? 'enviado' : r.simulado ? 'SIMULADO (SMTP não configurado)' : 'falhou'} ${r.detalhe}`);
    } catch (e) {
      this.logger.warn(`Falha ao enviar aviso do portal: ${(e as Error).message}`);
    }
  }
}
