import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Acesso } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { Area, perfilPodeAcessar } from '../common/rbac/acesso.config';

/** Mensagem trocada com o assistente (texto simples, sem blocos de ferramenta). */
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Ferramenta de leitura exposta ao agente. `area` gateia por RBAC (o agente só
 * recebe as ferramentas que o perfil do usuário logado pode ver).
 */
interface Ferramenta {
  def: Anthropic.Tool;
  areas: Area[]; // liberado se o perfil enxerga PELO MENOS UMA
  run: (empresaId: number, input: Record<string, unknown>) => Promise<unknown>;
}

const num = (v: unknown) => Number(v ?? 0);
const clampLimite = (v: unknown, def = 20) => Math.min(Math.max(Number(v ?? def) || def, 1), 100);

/**
 * Fase 5 (SPEC §6) — Agente de IA operando o ERP via *tool use*.
 *
 * O agente conversa em PT-BR e responde consultando a base de dados através de
 * ferramentas (function calling). Cada ferramenta é uma CONSULTA de leitura,
 * escopada por `empresaId` e liberada conforme o perfil (RBAC) do usuário
 * logado — o mesmo mapa de áreas do resto do sistema. É consultivo: não altera
 * dados (ações continuam pelas telas com auditoria).
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
      };
    }

    const ferramentas = this.ferramentasDoPerfil(user.acesso);
    const tools = ferramentas.map((f) => f.def);

    const messages: Anthropic.MessageParam[] = [
      ...historico
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: mensagem },
    ];

    try {
      // Loop agêntico manual: executa ferramentas até o modelo concluir.
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
          return { resposta: resposta || 'Não consegui elaborar uma resposta.', configurado: true };
        }

        // Guarda a vez do assistente (com os blocos tool_use) e executa cada chamada.
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
            saida = { erro: 'Falha ao consultar os dados.' };
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
      };
    } catch (e) {
      this.logger.error(`Erro no agente: ${String(e)}`);
      return {
        resposta: 'Tive um problema ao falar com o serviço de IA. Tente novamente em instantes.',
        configurado: true,
      };
    }
  }

  // ===== System prompt =====
  private systemPrompt(user: AuthUser, ferramentas: Ferramenta[]): string {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const listaFerr = ferramentas.map((f) => `- ${f.def.name}: ${f.def.description}`).join('\n');
    return [
      'Você é o assistente interno do Cherkesian ERP, sistema do Grupo Cherkesian (fábrica de uniformes profissionais).',
      `Hoje é ${hoje}. Você conversa com ${user.nome} (usuário "${user.usuario}", perfil de acesso "${user.acesso}").`,
      '',
      'Seu papel é ajudar a equipe a consultar e entender os dados do ERP. Regras:',
      '- Responda SEMPRE em português do Brasil, de forma objetiva e cordial.',
      '- Use as ferramentas para obter dados REAIS antes de responder. NUNCA invente números, valores ou nomes.',
      '- Valores monetários em reais (R$). Datas no formato dd/mm/aaaa.',
      '- Se a pergunta for fora do escopo dos dados disponíveis, diga o que você consegue consultar.',
      '- Você é CONSULTIVO: não cria, altera nem exclui registros. Se pedirem uma ação (criar pedido, gerar OP, emitir NF, dar baixa, etc.), oriente a usar a tela correspondente do sistema.',
      '- Seja conciso: prefira listas curtas e totais a despejar tabelas gigantes.',
      '',
      'Ferramentas disponíveis para o seu perfil:',
      listaFerr || '(nenhuma — informe que o perfil não tem consultas liberadas)',
    ].join('\n');
  }

  // ===== Registro de ferramentas =====
  private ferramentasDoPerfil(acesso: Acesso): Ferramenta[] {
    return this.todasFerramentas().filter((f) =>
      f.areas.some((a) => perfilPodeAcessar(acesso, a)),
    );
  }

  private todasFerramentas(): Ferramenta[] {
    return [
      {
        areas: ['dashboard'],
        def: {
          name: 'consultar_dashboard',
          description:
            'Visão geral operacional: pedidos por etapa, ordens de produção por status, total a receber em aberto, títulos vencidos e materiais abaixo do estoque mínimo.',
          input_schema: { type: 'object', properties: {} },
        },
        run: (empresaId) => this.dashboard(empresaId),
      },
      {
        areas: ['vendas'],
        def: {
          name: 'listar_pedidos',
          description:
            'Lista pedidos/orçamentos com cliente, valor, status e etapa. Filtre por etapa quando útil.',
          input_schema: {
            type: 'object',
            properties: {
              etapa: {
                type: 'string',
                enum: ['orcamento', 'aprovado', 'piloto', 'material', 'compra', 'producao', 'estoque', 'expedicao'],
                description: 'Etapa do pedido (opcional).',
              },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 20).' },
            },
          },
        },
        run: (empresaId, input) => this.pedidos(empresaId, input),
      },
      {
        areas: ['clientes'],
        def: {
          name: 'listar_clientes',
          description: 'Lista clientes cadastrados (nome, fantasia, CNPJ/CPF, cidade/UF, segmento).',
          input_schema: {
            type: 'object',
            properties: {
              busca: { type: 'string', description: 'Filtra por parte do nome (opcional).' },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 20).' },
            },
          },
        },
        run: (empresaId, input) => this.clientes(empresaId, input),
      },
      {
        areas: ['precificacao', 'cadastros'],
        def: {
          name: 'listar_produtos',
          description: 'Lista produtos cadastrados (código, categoria, descrição, preço base).',
          input_schema: {
            type: 'object',
            properties: {
              busca: { type: 'string', description: 'Filtra por descrição/categoria (opcional).' },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 20).' },
            },
          },
        },
        run: (empresaId, input) => this.produtos(empresaId, input),
      },
      {
        areas: ['estoque'],
        def: {
          name: 'consultar_estoque_materiais',
          description:
            'Saldo de matéria-prima/insumos: código, descrição, saldo, mínimo e unidade. Use somente_abaixo_minimo para achar o que precisa comprar.',
          input_schema: {
            type: 'object',
            properties: {
              somente_abaixo_minimo: { type: 'boolean', description: 'Retorna só itens com saldo abaixo do mínimo.' },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 30).' },
            },
          },
        },
        run: (empresaId, input) => this.materiais(empresaId, input),
      },
      {
        areas: ['producao', 'pcp'],
        def: {
          name: 'consultar_producao',
          description:
            'Ordens de produção (OP): número, quantidade, status, progresso %, prioridade, setor atual e previsão de entrega.',
          input_schema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['aguardando_material', 'a_iniciar', 'em_corte', 'em_producao', 'em_faccao', 'concluido'],
                description: 'Filtra por status (opcional).',
              },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 30).' },
            },
          },
        },
        run: (empresaId, input) => this.producao(empresaId, input),
      },
      {
        areas: ['receber'],
        def: {
          name: 'listar_titulos_receber',
          description:
            'Contas a receber em aberto: vencimento, valor, já pago, saldo e se está vencido. Inclui o total em aberto.',
          input_schema: {
            type: 'object',
            properties: {
              somente_vencidos: { type: 'boolean', description: 'Retorna só os títulos vencidos.' },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 30).' },
            },
          },
        },
        run: (empresaId, input) => this.receber(empresaId, input),
      },
      {
        areas: ['pagar'],
        def: {
          name: 'listar_titulos_pagar',
          description:
            'Contas a pagar em aberto: categoria, vencimento, valor, já pago, saldo e se está vencido. Inclui o total em aberto.',
          input_schema: {
            type: 'object',
            properties: {
              somente_vencidos: { type: 'boolean', description: 'Retorna só os títulos vencidos.' },
              limite: { type: 'integer', description: 'Máximo de registros (padrão 30).' },
            },
          },
        },
        run: (empresaId, input) => this.pagar(empresaId, input),
      },
    ];
  }

  // ===== Implementação das consultas (leitura) =====
  private async dashboard(empresaId: number) {
    const [pedidos, ops, receber, materiais] = await Promise.all([
      this.prisma.pedido.groupBy({ by: ['etapa'], where: { empresaId }, _count: { _all: true } }),
      this.prisma.oP.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.contaReceber.findMany({
        where: { empresaId, status: { not: 'pago' } },
        select: { valor: true, pago: true, vencimento: true },
      }),
      this.prisma.material.findMany({
        where: { empresaId },
        select: { codigo: true, descricao: true, saldo: true, minimo: true, unidade: true },
      }),
    ]);
    const hoje = new Date();
    const receberAberto = receber.reduce((s, c) => s + (num(c.valor) - num(c.pago)), 0);
    const receberVencidos = receber.filter((c) => c.vencimento < hoje).length;
    const abaixoMinimo = materiais
      .filter((m) => num(m.saldo) < num(m.minimo))
      .map((m) => ({ codigo: m.codigo, descricao: m.descricao, saldo: num(m.saldo), minimo: num(m.minimo), unidade: m.unidade }));
    return {
      pedidos_por_etapa: Object.fromEntries(pedidos.map((p) => [p.etapa, p._count._all])),
      ordens_producao_por_status: Object.fromEntries(ops.map((o) => [o.status, o._count._all])),
      contas_a_receber_em_aberto: Number(receberAberto.toFixed(2)),
      titulos_a_receber_vencidos: receberVencidos,
      materiais_abaixo_do_minimo: abaixoMinimo,
    };
  }

  private async pedidos(empresaId: number, input: Record<string, unknown>) {
    const etapa = input.etapa as string | undefined;
    const registros = await this.prisma.pedido.findMany({
      where: { empresaId, ...(etapa ? { etapa: etapa as never } : {}) },
      include: { cliente: { select: { nome: true } } },
      orderBy: { id: 'desc' },
      take: clampLimite(input.limite),
    });
    return registros.map((p) => ({
      numero: p.numero,
      cliente: p.cliente?.nome,
      valor_total: num(p.valorTotal),
      status: p.status,
      etapa: p.etapa,
      data: p.data.toISOString().slice(0, 10),
    }));
  }

  private async clientes(empresaId: number, input: Record<string, unknown>) {
    const busca = (input.busca as string | undefined)?.trim();
    const registros = await this.prisma.cliente.findMany({
      where: { empresaId, ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}) },
      orderBy: { nome: 'asc' },
      take: clampLimite(input.limite),
      select: { nome: true, fantasia: true, cnpjCpf: true, cidadeUf: true, segmento: true },
    });
    return registros;
  }

  private async produtos(empresaId: number, input: Record<string, unknown>) {
    const busca = (input.busca as string | undefined)?.trim();
    const registros = await this.prisma.produto.findMany({
      where: {
        empresaId,
        ...(busca
          ? { OR: [{ descricao: { contains: busca, mode: 'insensitive' } }, { categoria: { contains: busca, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { codigo: 'asc' },
      take: clampLimite(input.limite),
      select: { codigo: true, categoria: true, descricao: true, cor: true, precoBase: true },
    });
    return registros.map((p) => ({
      codigo: p.codigo,
      categoria: p.categoria,
      descricao: p.descricao,
      cor: p.cor,
      preco_base: p.precoBase ? num(p.precoBase) : null,
    }));
  }

  private async materiais(empresaId: number, input: Record<string, unknown>) {
    const registros = await this.prisma.material.findMany({
      where: { empresaId },
      orderBy: { codigo: 'asc' },
      take: clampLimite(input.limite, 30),
      select: { codigo: true, descricao: true, saldo: true, minimo: true, unidade: true },
    });
    const mapear = (m: (typeof registros)[number]) => ({
      codigo: m.codigo,
      descricao: m.descricao,
      saldo: num(m.saldo),
      minimo: num(m.minimo),
      unidade: m.unidade,
      abaixo_do_minimo: num(m.saldo) < num(m.minimo),
    });
    const lista = registros.map(mapear);
    return input.somente_abaixo_minimo ? lista.filter((m) => m.abaixo_do_minimo) : lista;
  }

  private async producao(empresaId: number, input: Record<string, unknown>) {
    const status = input.status as string | undefined;
    const registros = await this.prisma.oP.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      orderBy: { id: 'desc' },
      take: clampLimite(input.limite, 30),
      select: {
        numero: true,
        quantidade: true,
        status: true,
        progresso: true,
        prioridade: true,
        setorAtual: true,
        entregaPrev: true,
      },
    });
    return registros.map((o) => ({
      numero: o.numero,
      quantidade: o.quantidade,
      status: o.status,
      progresso_pct: o.progresso,
      prioridade: o.prioridade,
      setor_atual: o.setorAtual,
      entrega_prevista: o.entregaPrev ? o.entregaPrev.toISOString().slice(0, 10) : null,
    }));
  }

  private async receber(empresaId: number, input: Record<string, unknown>) {
    return this.titulos('receber', empresaId, input);
  }

  private async pagar(empresaId: number, input: Record<string, unknown>) {
    return this.titulos('pagar', empresaId, input);
  }

  private async titulos(tipo: 'receber' | 'pagar', empresaId: number, input: Record<string, unknown>) {
    const hoje = new Date();
    const registros =
      tipo === 'receber'
        ? await this.prisma.contaReceber.findMany({
            where: { empresaId, status: { not: 'pago' } },
            orderBy: { vencimento: 'asc' },
            take: clampLimite(input.limite, 30),
            select: { vencimento: true, valor: true, pago: true, status: true },
          })
        : await this.prisma.contaPagar.findMany({
            where: { empresaId, status: { not: 'pago' } },
            orderBy: { vencimento: 'asc' },
            take: clampLimite(input.limite, 30),
            select: { vencimento: true, valor: true, pago: true, status: true, categoria: true },
          });
    const lista = registros.map((c) => {
      const saldo = num(c.valor) - num(c.pago);
      return {
        ...(('categoria' in c) ? { categoria: (c as { categoria: string }).categoria } : {}),
        vencimento: c.vencimento.toISOString().slice(0, 10),
        valor: num(c.valor),
        pago: num(c.pago),
        saldo: Number(saldo.toFixed(2)),
        status: c.status,
        vencido: c.vencimento < hoje,
      };
    });
    const filtrada = input.somente_vencidos ? lista.filter((c) => c.vencido) : lista;
    const totalAberto = filtrada.reduce((s, c) => s + c.saldo, 0);
    return { total_em_aberto: Number(totalAberto.toFixed(2)), quantidade: filtrada.length, titulos: filtrada };
  }
}
