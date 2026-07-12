import Anthropic from '@anthropic-ai/sdk';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Acesso } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { Area, perfilPodeAcessar } from '../common/rbac/acesso.config';
import { PedidosService } from '../pedidos/pedidos.service';
import { ClientesService } from '../clientes/clientes.service';
import { CreateClienteDto } from '../clientes/dto/create-cliente.dto';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';

/** Mensagem trocada com o assistente (texto simples, sem blocos de ferramenta). */
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** Proposta de ação registrada durante a conversa, aguardando confirmação do usuário. */
export interface PropostaAcao {
  id: string;
  tipo: string;
  descricao: string;
  dados: Record<string, unknown>;
}

interface Ferramenta {
  def: Anthropic.Tool;
  areas: Area[];
  run: (empresaId: number, input: Record<string, unknown>) => Promise<unknown>;
}

const num = (v: unknown) => Number(v ?? 0);
const clampLimite = (v: unknown, def = 20) => Math.min(Math.max(Number(v ?? def) || def, 1), 100);

/** Áreas exigidas por cada tipo de AÇÃO (usado no gate das ferramentas e no /executar). */
const ACOES_AREAS: Record<string, Area[]> = {
  criar_cliente: ['clientes'],
  criar_orcamento: ['vendas'],
  aprovar_pedido: ['vendas'],
  gerar_op: ['pcp', 'producao'],
};

/**
 * Fase 5 (SPEC §6) — Agente de IA operando o ERP via *tool use*.
 *
 * Consultas: ferramentas de LEITURA escopadas por empresaId e liberadas por RBAC.
 * Ações: o agente PROPÕE (criar cliente/orçamento, aprovar pedido, gerar OP); a
 * execução real só acontece após o usuário CONFIRMAR na tela, via /agente/executar,
 * reusando as regras de negócio dos serviços (Pedidos/Clientes) — com RBAC + auditoria.
 *
 * Sem ANTHROPIC_API_KEY, devolve um aviso amigável (a tela funciona, mas sem IA).
 */
@Injectable()
export class AgenteService {
  private readonly logger = new Logger(AgenteService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pedidos: PedidosService,
    private readonly clientes: ClientesService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = this.config.get<string>('AGENT_MODEL') || 'claude-opus-4-8';
  }

  configurado(): boolean {
    return this.client !== null;
  }

  async chat(user: AuthUser, mensagem: string, historico: ChatMsg[] = []) {
    if (!this.client) {
      return {
        resposta:
          'O Assistente de IA ainda não está configurado. Peça ao administrador para definir a variável ANTHROPIC_API_KEY no servidor.',
        configurado: false,
        acoes: [],
      };
    }

    const propostas: PropostaAcao[] = [];
    const ferramentas = this.montarFerramentas(user, propostas).filter((f) =>
      f.areas.some((a) => perfilPodeAcessar(user.acesso, a)),
    );
    const tools = ferramentas.map((f) => f.def);

    const messages: Anthropic.MessageParam[] = [
      ...historico
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: mensagem },
    ];

    try {
      for (let i = 0; i < 6; i++) {
        const resp = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          system: this.systemPrompt(user, ferramentas),
          tools,
          messages,
        });

        if (resp.stop_reason !== 'tool_use') {
          const resposta = resp.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
          return { resposta: resposta || 'Não consegui elaborar uma resposta.', configurado: true, acoes: propostas };
        }

        messages.push({ role: 'assistant', content: resp.content });
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        for (const bloco of resp.content) {
          if (bloco.type !== 'tool_use') continue;
          const ferr = ferramentas.find((f) => f.def.name === bloco.name);
          let saida: unknown;
          try {
            saida = ferr
              ? await ferr.run(user.empresaId, (bloco.input ?? {}) as Record<string, unknown>)
              : { erro: 'Ferramenta indisponível para o seu perfil.' };
          } catch (e) {
            this.logger.error(`Ferramenta ${bloco.name} falhou: ${String(e)}`);
            saida = { erro: e instanceof Error ? e.message : 'Falha ao consultar os dados.' };
          }
          resultados.push({
            type: 'tool_result',
            tool_use_id: bloco.id,
            content: JSON.stringify(saida).slice(0, 12000),
          });
        }
        messages.push({ role: 'user', content: resultados });
      }
      return {
        resposta: 'A consulta ficou complexa demais. Reformule a pergunta de forma mais específica, por favor.',
        configurado: true,
        acoes: propostas,
      };
    } catch (e) {
      this.logger.error(`Erro no agente: ${String(e)}`);
      return {
        resposta: 'Tive um problema ao falar com o serviço de IA. Tente novamente em instantes.',
        configurado: true,
        acoes: [],
      };
    }
  }

  /** Executa uma ação previamente PROPOSTA pelo agente, após confirmação do usuário. */
  async executar(user: AuthUser, tipo: string, dados: Record<string, unknown>) {
    const areas = ACOES_AREAS[tipo];
    if (!areas) throw new BadRequestException('Ação desconhecida.');
    if (!areas.some((a) => perfilPodeAcessar(user.acesso, a))) {
      throw new ForbiddenException('Seu perfil não pode executar esta ação.');
    }
    const eId = user.empresaId;
    switch (tipo) {
      case 'criar_cliente': {
        const r = await this.clientes.create(dados as unknown as CreateClienteDto, eId);
        return { ok: true, resumo: `Cliente "${r.nome}" cadastrado (código #${r.id}).`, resultado: r };
      }
      case 'criar_orcamento': {
        const r = await this.pedidos.create(dados as unknown as CreatePedidoDto, eId, user.usuario);
        return { ok: true, resumo: `Orçamento ${r.numero} criado — total R$ ${num(r.valorTotal).toFixed(2)}.`, resultado: r };
      }
      case 'aprovar_pedido': {
        const r = await this.pedidos.aprovar(Number(dados.pedidoId), eId);
        return { ok: true, resumo: `Pedido ${r.numero} aprovado (etapa: ${r.etapa}).`, resultado: r };
      }
      case 'gerar_op': {
        const r: any = await this.pedidos.gerarOp(Number(dados.pedidoId), eId);
        let resumo: string;
        if (r.status === 'op_gerada') resumo = `OP ${r.op.numero} gerada (${r.op.quantidade} peças). Pedido em produção.`;
        else if (r.status === 'bloqueado_material')
          resumo = `Material insuficiente — geradas ${r.ordensCompra.length} ordem(ns) de compra: ${r.ordensCompra.map((o: any) => o.numero).join(', ')}.`;
        else if (r.status === 'bloqueado_piloto') resumo = 'Bloqueado: cliente novo exige peça-piloto aprovada antes da OP.';
        else resumo = 'Ação processada.';
        return { ok: true, resumo, resultado: r };
      }
      default:
        throw new BadRequestException('Ação desconhecida.');
    }
  }

  // ===== System prompt =====
  private systemPrompt(user: AuthUser, ferramentas: Ferramenta[]): string {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const listaFerr = ferramentas.map((f) => `- ${f.def.name}: ${f.def.description}`).join('\n');
    return [
      'Você é o assistente interno do Cherkesian ERP, sistema do Grupo Cherkesian (fábrica de uniformes profissionais).',
      `Hoje é ${hoje}. Você conversa com ${user.nome} (usuário "${user.usuario}", perfil "${user.acesso}").`,
      '',
      'Regras:',
      '- Responda SEMPRE em português do Brasil, de forma objetiva e cordial.',
      '- Use as ferramentas de CONSULTA para obter dados REAIS antes de responder. NUNCA invente números, valores ou nomes.',
      '- Valores em reais (R$). Datas no formato dd/mm/aaaa.',
      '- Seja conciso: prefira listas curtas e totais.',
      '',
      'AÇÕES (criar cliente, criar orçamento, aprovar pedido, gerar OP): quando o usuário pedir para EXECUTAR algo,',
      'chame a ferramenta de ação correspondente com os dados. IMPORTANTE: a ação NÃO é executada na hora —',
      'ela vira uma PROPOSTA que aparece na tela para o usuário CONFIRMAR ou CANCELAR. Depois de chamar a ferramenta',
      'de ação, apenas confirme em uma frase que registrou a proposta e peça a confirmação. Não afirme que já foi feito.',
      'Se faltar informação para a ação (ex.: itens do orçamento), pergunte antes de propor.',
      '',
      'Ferramentas disponíveis para o seu perfil:',
      listaFerr || '(nenhuma — informe que o perfil não tem operações liberadas)',
    ].join('\n');
  }

  // ===== Registro de ferramentas (consultas + ações) =====
  private montarFerramentas(user: AuthUser, propostas: PropostaAcao[]): Ferramenta[] {
    const acao = (
      name: keyof typeof ACOES_AREAS,
      def: Anthropic.Tool,
      validar: (empresaId: number, input: Record<string, unknown>) => Promise<{ dados: Record<string, unknown>; descricao: string }>,
    ): Ferramenta => ({
      def,
      areas: ACOES_AREAS[name],
      run: async (empresaId, input) => {
        try {
          if (propostas.length >= 5) return { erro: 'Muitas ações pendentes. Peça ao usuário para confirmá-las primeiro.' };
          const { dados, descricao } = await validar(empresaId, input);
          propostas.push({ id: 'act' + (propostas.length + 1), tipo: name, descricao, dados });
          return {
            proposta_registrada: true,
            resumo: descricao,
            instrucao: 'A ação NÃO foi executada. Uma proposta foi criada para o usuário confirmar na tela. Apenas informe que registrou a proposta e aguarde a confirmação.',
          };
        } catch (e) {
          return { erro: e instanceof Error ? e.message : 'Não foi possível preparar a ação.' };
        }
      },
    });

    return [
      // ===== CONSULTAS =====
      {
        areas: ['dashboard'],
        def: { name: 'consultar_dashboard', description: 'Visão geral: pedidos por etapa, OPs por status, total a receber em aberto, títulos vencidos e materiais abaixo do mínimo.', input_schema: { type: 'object', properties: {} } },
        run: (empresaId) => this.dashboard(empresaId),
      },
      {
        areas: ['vendas'],
        def: { name: 'listar_pedidos', description: 'Lista pedidos/orçamentos (cliente, valor, status, etapa). Filtre por etapa quando útil.', input_schema: { type: 'object', properties: { etapa: { type: 'string', enum: ['orcamento', 'aprovado', 'piloto', 'material', 'compra', 'producao', 'estoque', 'expedicao'] }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.pedidosLista(empresaId, input),
      },
      {
        areas: ['vendas', 'pcp'],
        def: { name: 'detalhar_pedido', description: 'Detalhes de UM pedido: cliente, status, etapa, forma de pagamento, observações e itens (descrição, qtd, valor). Informe o número (ex.: PV01) ou o id.', input_schema: { type: 'object', properties: { pedido: { type: 'string', description: 'Número (PV01) ou id do pedido.' } }, required: ['pedido'] } },
        run: (empresaId, input) => this.detalharPedido(empresaId, input),
      },
      {
        areas: ['clientes'],
        def: { name: 'listar_clientes', description: 'Lista clientes (nome, fantasia, CNPJ/CPF, cidade/UF, segmento).', input_schema: { type: 'object', properties: { busca: { type: 'string' }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.clientesLista(empresaId, input),
      },
      {
        areas: ['precificacao', 'cadastros'],
        def: { name: 'listar_produtos', description: 'Lista produtos (código, categoria, descrição, preço base).', input_schema: { type: 'object', properties: { busca: { type: 'string' }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.produtosLista(empresaId, input),
      },
      {
        areas: ['estoque'],
        def: { name: 'consultar_estoque_materiais', description: 'Saldo de matéria-prima/insumos (código, descrição, saldo, mínimo, unidade). Use somente_abaixo_minimo para o que precisa comprar.', input_schema: { type: 'object', properties: { somente_abaixo_minimo: { type: 'boolean' }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.materiaisLista(empresaId, input),
      },
      {
        areas: ['producao', 'pcp'],
        def: { name: 'consultar_producao', description: 'Ordens de produção (OP): número, quantidade, status, progresso %, prioridade, setor e previsão de entrega.', input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['aguardando_material', 'a_iniciar', 'em_corte', 'em_producao', 'em_faccao', 'concluido'] }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.producaoLista(empresaId, input),
      },
      {
        areas: ['piloto'],
        def: { name: 'consultar_pilotos', description: 'Peças-piloto: código, pedido, status, tentativa e se está liberada para produção.', input_schema: { type: 'object', properties: { limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.pilotosLista(empresaId, input),
      },
      {
        areas: ['compras'],
        def: { name: 'consultar_ordens_compra', description: 'Ordens de compra: número, material, quantidade, valor, fornecedor e status.', input_schema: { type: 'object', properties: { limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.comprasLista(empresaId, input),
      },
      {
        areas: ['expedicao'],
        def: { name: 'consultar_expedicoes', description: 'Expedições/envios: número, status, NF, transportadora, peças, volumes e data.', input_schema: { type: 'object', properties: { limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.expedicoesLista(empresaId, input),
      },
      {
        areas: ['comissoes'],
        def: { name: 'consultar_comissoes', description: 'Comissões por venda: vendedor, valor da venda, comissão e status de pagamento. Inclui total a pagar.', input_schema: { type: 'object', properties: { limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.comissoesLista(empresaId, input),
      },
      {
        areas: ['expedicao', 'receber'],
        def: { name: 'consultar_notas_fiscais', description: 'Notas fiscais emitidas: número, série, status, valor, provedor e data.', input_schema: { type: 'object', properties: { limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.notasLista(empresaId, input),
      },
      {
        areas: ['receber'],
        def: { name: 'listar_titulos_receber', description: 'Contas a receber em aberto (vencimento, valor, pago, saldo, vencido) + total.', input_schema: { type: 'object', properties: { somente_vencidos: { type: 'boolean' }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.titulos('receber', empresaId, input),
      },
      {
        areas: ['pagar'],
        def: { name: 'listar_titulos_pagar', description: 'Contas a pagar em aberto (categoria, vencimento, valor, pago, saldo, vencido) + total.', input_schema: { type: 'object', properties: { somente_vencidos: { type: 'boolean' }, limite: { type: 'integer' } } } },
        run: (empresaId, input) => this.titulos('pagar', empresaId, input),
      },

      // ===== AÇÕES (propostas — confirmadas pelo usuário) =====
      acao(
        'criar_cliente',
        { name: 'criar_cliente', description: 'PROPÕE cadastrar um novo cliente. Requer o nome; opcional fantasia, CNPJ/CPF, cidade/UF, segmento, telefone, e-mail.', input_schema: { type: 'object', properties: { nome: { type: 'string' }, fantasia: { type: 'string' }, cnpjCpf: { type: 'string' }, cidadeUf: { type: 'string' }, segmento: { type: 'string' }, telefone: { type: 'string' }, email: { type: 'string' } }, required: ['nome'] } },
        async (_e, input) => {
          const nome = String(input.nome ?? '').trim();
          if (!nome) throw new BadRequestException('Informe o nome do cliente.');
          const dados = { nome, fantasia: input.fantasia, cnpjCpf: input.cnpjCpf, cidadeUf: input.cidadeUf, segmento: input.segmento, telefone: input.telefone, email: input.email };
          return { dados, descricao: `Cadastrar cliente "${nome}"${input.cidadeUf ? ' (' + input.cidadeUf + ')' : ''}` };
        },
      ),
      acao(
        'criar_orcamento',
        { name: 'criar_orcamento', description: 'PROPÕE criar um orçamento. Informe o cliente (nome ou id) e os itens (descrição, quantidade, valor unitário).', input_schema: { type: 'object', properties: { cliente: { type: 'string', description: 'Nome ou id do cliente.' }, itens: { type: 'array', items: { type: 'object', properties: { descricao: { type: 'string' }, quantidade: { type: 'integer' }, valorUnit: { type: 'number' }, produtoId: { type: 'integer' } }, required: ['quantidade', 'valorUnit'] } }, formaPagamento: { type: 'string' }, obs: { type: 'string' } }, required: ['cliente', 'itens'] } },
        async (empresaId, input) => {
          const { id: clienteId, nome } = await this.resolverCliente(empresaId, input.cliente);
          const itensIn = Array.isArray(input.itens) ? (input.itens as Record<string, unknown>[]) : [];
          if (!itensIn.length) throw new BadRequestException('Informe ao menos um item.');
          const itens = itensIn.map((it) => {
            const quantidade = Number(it.quantidade);
            const valorUnit = Number(it.valorUnit);
            if (!it.descricao && !it.produtoId) throw new BadRequestException('Cada item precisa de descrição ou produtoId.');
            if (!(quantidade >= 1)) throw new BadRequestException('Quantidade de item deve ser ao menos 1.');
            if (!(valorUnit > 0)) throw new BadRequestException('Valor unitário deve ser positivo.');
            return { produtoId: it.produtoId ? Number(it.produtoId) : undefined, descricao: it.descricao as string | undefined, quantidade, valorUnit };
          });
          const total = itens.reduce((s, it) => s + it.quantidade * it.valorUnit, 0);
          const dados = { clienteId, itens, formaPagamento: input.formaPagamento, obs: input.obs };
          return { dados, descricao: `Criar orçamento para ${nome} — ${itens.length} item(ns), total R$ ${total.toFixed(2)}` };
        },
      ),
      acao(
        'aprovar_pedido',
        { name: 'aprovar_pedido', description: 'PROPÕE aprovar um orçamento (vira pedido). Informe o número (PV01) ou o id.', input_schema: { type: 'object', properties: { pedido: { type: 'string' } }, required: ['pedido'] } },
        async (empresaId, input) => {
          const p = await this.resolverPedido(empresaId, input.pedido);
          return { dados: { pedidoId: p.id }, descricao: `Aprovar o orçamento ${p.numero} (cliente ${p.cliente?.nome ?? '—'})` };
        },
      ),
      acao(
        'gerar_op',
        { name: 'gerar_op', description: 'PROPÕE gerar a Ordem de Produção de um pedido (dispara a automação de material/OP). Informe o número (PV01) ou o id.', input_schema: { type: 'object', properties: { pedido: { type: 'string' } }, required: ['pedido'] } },
        async (empresaId, input) => {
          const p = await this.resolverPedido(empresaId, input.pedido);
          return { dados: { pedidoId: p.id }, descricao: `Gerar Ordem de Produção do pedido ${p.numero}` };
        },
      ),
    ];
  }

  // ===== Resolvedores =====
  private async resolverCliente(empresaId: number, ref: unknown) {
    const txt = String(ref ?? '').trim();
    if (!txt) throw new BadRequestException('Informe o cliente.');
    if (/^\d+$/.test(txt)) {
      const c = await this.prisma.cliente.findUnique({ where: { id: Number(txt) } });
      if (c && c.empresaId === empresaId) return { id: c.id, nome: c.nome };
    }
    const achados = await this.prisma.cliente.findMany({
      where: { empresaId, nome: { contains: txt, mode: 'insensitive' } },
      take: 2,
      select: { id: true, nome: true },
    });
    if (!achados.length) throw new NotFoundException(`Cliente "${txt}" não encontrado. Cadastre-o antes ou confira o nome.`);
    return achados[0];
  }

  private async resolverPedido(empresaId: number, ref: unknown) {
    const txt = String(ref ?? '').trim();
    if (!txt) throw new BadRequestException('Informe o pedido.');
    const pedido = /^\d+$/.test(txt)
      ? await this.prisma.pedido.findUnique({ where: { id: Number(txt) }, include: { cliente: { select: { nome: true } } } })
      : await this.prisma.pedido.findUnique({ where: { numero: txt }, include: { cliente: { select: { nome: true } } } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido "${txt}" não encontrado.`);
    return pedido;
  }

  // ===== Consultas (leitura) =====
  private async dashboard(empresaId: number) {
    const [pedidos, ops, receber, materiais] = await Promise.all([
      this.prisma.pedido.groupBy({ by: ['etapa'], where: { empresaId }, _count: { _all: true } }),
      this.prisma.oP.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.contaReceber.findMany({ where: { empresaId, status: { not: 'pago' } }, select: { valor: true, pago: true, vencimento: true } }),
      this.prisma.material.findMany({ where: { empresaId }, select: { codigo: true, descricao: true, saldo: true, minimo: true, unidade: true } }),
    ]);
    const hoje = new Date();
    const receberAberto = receber.reduce((s, c) => s + (num(c.valor) - num(c.pago)), 0);
    const abaixoMinimo = materiais.filter((m) => num(m.saldo) < num(m.minimo)).map((m) => ({ codigo: m.codigo, descricao: m.descricao, saldo: num(m.saldo), minimo: num(m.minimo), unidade: m.unidade }));
    return {
      pedidos_por_etapa: Object.fromEntries(pedidos.map((p) => [p.etapa, p._count._all])),
      ordens_producao_por_status: Object.fromEntries(ops.map((o) => [o.status, o._count._all])),
      contas_a_receber_em_aberto: Number(receberAberto.toFixed(2)),
      titulos_a_receber_vencidos: receber.filter((c) => c.vencimento < hoje).length,
      materiais_abaixo_do_minimo: abaixoMinimo,
    };
  }

  private async pedidosLista(empresaId: number, input: Record<string, unknown>) {
    const etapa = input.etapa as string | undefined;
    const registros = await this.prisma.pedido.findMany({
      where: { empresaId, ...(etapa ? { etapa: etapa as never } : {}) },
      include: { cliente: { select: { nome: true } } },
      orderBy: { id: 'desc' },
      take: clampLimite(input.limite),
    });
    return registros.map((p) => ({ numero: p.numero, cliente: p.cliente?.nome, valor_total: num(p.valorTotal), status: p.status, etapa: p.etapa, data: p.data.toISOString().slice(0, 10) }));
  }

  private async detalharPedido(empresaId: number, input: Record<string, unknown>) {
    const p = await this.prisma.pedido.findFirst({
      where: /^\d+$/.test(String(input.pedido ?? '')) ? { id: Number(input.pedido), empresaId } : { numero: String(input.pedido ?? ''), empresaId },
      include: { cliente: { select: { nome: true } }, itens: true },
    });
    if (!p) throw new NotFoundException(`Pedido "${input.pedido}" não encontrado.`);
    return {
      numero: p.numero,
      cliente: p.cliente?.nome,
      status: p.status,
      etapa: p.etapa,
      forma_pagamento: p.formaPagamento,
      observacoes: p.obs,
      valor_total: num(p.valorTotal),
      itens: p.itens.map((it) => ({ descricao: it.descricao, quantidade: it.quantidade, valor_unit: num(it.valorUnit), subtotal: Number((num(it.valorUnit) * it.quantidade).toFixed(2)) })),
    };
  }

  private async clientesLista(empresaId: number, input: Record<string, unknown>) {
    const busca = (input.busca as string | undefined)?.trim();
    return this.prisma.cliente.findMany({
      where: { empresaId, ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}) },
      orderBy: { nome: 'asc' },
      take: clampLimite(input.limite),
      select: { nome: true, fantasia: true, cnpjCpf: true, cidadeUf: true, segmento: true },
    });
  }

  private async produtosLista(empresaId: number, input: Record<string, unknown>) {
    const busca = (input.busca as string | undefined)?.trim();
    const registros = await this.prisma.produto.findMany({
      where: { empresaId, ...(busca ? { OR: [{ descricao: { contains: busca, mode: 'insensitive' } }, { categoria: { contains: busca, mode: 'insensitive' } }] } : {}) },
      orderBy: { codigo: 'asc' },
      take: clampLimite(input.limite),
      select: { codigo: true, categoria: true, descricao: true, cor: true, precoBase: true },
    });
    return registros.map((p) => ({ codigo: p.codigo, categoria: p.categoria, descricao: p.descricao, cor: p.cor, preco_base: p.precoBase ? num(p.precoBase) : null }));
  }

  private async materiaisLista(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.material.findMany({ where: { empresaId }, orderBy: { codigo: 'asc' }, take: clampLimite(input.limite, 30), select: { codigo: true, descricao: true, saldo: true, minimo: true, unidade: true } });
    const lista = registros.map((m) => ({ codigo: m.codigo, descricao: m.descricao, saldo: num(m.saldo), minimo: num(m.minimo), unidade: m.unidade, abaixo_do_minimo: num(m.saldo) < num(m.minimo) }));
    return input.somente_abaixo_minimo ? lista.filter((m) => m.abaixo_do_minimo) : lista;
  }

  private async producaoLista(empresaId: number, input: Record<string, unknown>) {
    const status = input.status as string | undefined;
    const registros = await this.prisma.oP.findMany({ where: { ...(status ? { status: status as never } : {}) }, orderBy: { id: 'desc' }, take: clampLimite(input.limite, 30), select: { numero: true, quantidade: true, status: true, progresso: true, prioridade: true, setorAtual: true, entregaPrev: true } });
    return registros.map((o) => ({ numero: o.numero, quantidade: o.quantidade, status: o.status, progresso_pct: o.progresso, prioridade: o.prioridade, setor_atual: o.setorAtual, entrega_prevista: o.entregaPrev ? o.entregaPrev.toISOString().slice(0, 10) : null }));
  }

  private async pilotosLista(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.piloto.findMany({ orderBy: { id: 'desc' }, take: clampLimite(input.limite, 30), include: { pedido: { select: { numero: true } } } });
    return registros.map((p) => ({ codigo: p.codigo, pedido: p.pedido?.numero, status: p.status, tentativa: p.tentativa, liberado: p.liberado }));
  }

  private async comprasLista(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.ordemCompra.findMany({ orderBy: { id: 'desc' }, take: clampLimite(input.limite, 30), include: { fornecedor: { select: { nome: true } } } });
    return registros.map((o) => ({ numero: o.numero, material: o.descricao, quantidade: num(o.quantidade), unidade: o.unidade, valor: num(o.valor), fornecedor: o.fornecedor?.nome, status: o.status }));
  }

  private async expedicoesLista(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.expedicao.findMany({ orderBy: { id: 'desc' }, take: clampLimite(input.limite, 30), select: { numero: true, status: true, nf: true, transportadora: true, rastreio: true, pecas: true, volumes: true, data: true } });
    return registros.map((e) => ({ numero: e.numero, status: e.status, nf: e.nf, transportadora: e.transportadora, rastreio: e.rastreio, pecas: e.pecas, volumes: e.volumes, data: e.data.toISOString().slice(0, 10) }));
  }

  private async comissoesLista(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.comissao.findMany({ where: { empresaId }, orderBy: { id: 'desc' }, take: clampLimite(input.limite, 30) });
    const lista = registros.map((c) => ({ vendedor: c.vendedor, valor_venda: num(c.valorVenda), comissao: num(c.comissao), status: c.statusPgto }));
    const totalApagar = lista.filter((c) => c.status !== 'Pago').reduce((s, c) => s + c.comissao, 0);
    return { total_comissao_a_pagar: Number(totalApagar.toFixed(2)), quantidade: lista.length, comissoes: lista };
  }

  private async notasLista(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.notaFiscal.findMany({ where: { empresaId }, orderBy: { id: 'desc' }, take: clampLimite(input.limite, 30), select: { numero: true, serie: true, status: true, valor: true, provedor: true, emitidaEm: true } });
    return registros.map((n) => ({ numero: n.numero, serie: n.serie, status: n.status, valor: num(n.valor), provedor: n.provedor, data: n.emitidaEm.toISOString().slice(0, 10) }));
  }

  private async titulos(tipo: 'receber' | 'pagar', empresaId: number, input: Record<string, unknown>) {
    const hoje = new Date();
    const registros =
      tipo === 'receber'
        ? await this.prisma.contaReceber.findMany({ where: { empresaId, status: { not: 'pago' } }, orderBy: { vencimento: 'asc' }, take: clampLimite(input.limite, 30), select: { vencimento: true, valor: true, pago: true, status: true } })
        : await this.prisma.contaPagar.findMany({ where: { empresaId, status: { not: 'pago' } }, orderBy: { vencimento: 'asc' }, take: clampLimite(input.limite, 30), select: { vencimento: true, valor: true, pago: true, status: true, categoria: true } });
    const lista = registros.map((c) => {
      const saldo = num(c.valor) - num(c.pago);
      return {
        ...('categoria' in c ? { categoria: (c as { categoria: string }).categoria } : {}),
        vencimento: c.vencimento.toISOString().slice(0, 10),
        valor: num(c.valor),
        pago: num(c.pago),
        saldo: Number(saldo.toFixed(2)),
        status: c.status,
        vencido: c.vencimento < hoje,
      };
    });
    const filtrada = input.somente_vencidos ? lista.filter((c) => c.vencido) : lista;
    return { total_em_aberto: Number(filtrada.reduce((s, c) => s + c.saldo, 0).toFixed(2)), quantidade: filtrada.length, titulos: filtrada };
  }
}
