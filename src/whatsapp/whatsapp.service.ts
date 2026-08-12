import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { proximoSequencial } from '../common/utils/codigo.util';

/**
 * Robô comercial de WhatsApp. Recebe mensagens (via webhook do provedor ou do
 * simulador), conversa com o cliente usando o Claude (tool use) para montar
 * orçamento com os PREÇOS DO CONTRATO e, ao aprovar, cria o Pedido no ERP.
 * Canal de saída = adapter (simulado | meta | zapi).
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsApp');
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

  // ===== Config =====
  async getConfig(empresaId: number) {
    const c = await this.prisma.whatsAppConfig.findUnique({ where: { empresaId } });
    return {
      provedor: c?.provedor ?? 'simulado',
      configurado: !!(c?.token && c?.phoneId) || c?.provedor === 'simulado',
      temToken: !!c?.token,
      phoneId: c?.phoneId ?? null,
      verifyToken: c?.verifyToken ?? null,
      saudacao: c?.saudacao ?? null,
      ativo: c?.ativo ?? false,
      soContrato: c?.soContrato ?? true,
      iaOk: !!this.client,
    };
  }

  async salvarConfig(empresaId: number, dto: { provedor?: string; token?: string; phoneId?: string; verifyToken?: string; saudacao?: string; ativo?: boolean; soContrato?: boolean }) {
    const data: Prisma.WhatsAppConfigUncheckedCreateInput = {
      empresaId,
      provedor: dto.provedor || 'simulado',
      phoneId: dto.phoneId?.trim() || null,
      verifyToken: dto.verifyToken?.trim() || null,
      saudacao: dto.saudacao?.trim() || null,
      ativo: dto.ativo ?? false,
      soContrato: dto.soContrato ?? true,
      ...(dto.token?.trim() ? { token: dto.token.trim() } : {}),
    } as Prisma.WhatsAppConfigUncheckedCreateInput;
    await this.prisma.whatsAppConfig.upsert({
      where: { empresaId },
      create: data,
      update: { ...data, ...(dto.token?.trim() ? {} : { token: undefined }) },
    });
    return this.getConfig(empresaId);
  }

  // ===== Conversas =====
  async listarConversas(empresaId: number) {
    const cs = await this.prisma.whatsAppConversa.findMany({
      where: { empresaId },
      orderBy: { atualizadoEm: 'desc' },
      take: 100,
    });
    return cs;
  }

  async detalheConversa(empresaId: number, id: number) {
    const c = await this.prisma.whatsAppConversa.findUnique({ where: { id }, include: { mensagens: { orderBy: { criadoEm: 'asc' } } } });
    if (!c || c.empresaId !== empresaId) throw new NotFoundException('Conversa não encontrada.');
    return c;
  }

  /** Operador humano assume a conversa (robô para de responder). */
  async assumir(empresaId: number, id: number, usuario: string) {
    const c = await this.detalheConversa(empresaId, id);
    await this.prisma.whatsAppConversa.update({ where: { id: c.id }, data: { estado: 'humano' } });
    await this.registrar(c.id, 'sistema', `Atendimento assumido por ${usuario}.`);
    return { ok: true };
  }

  /** Operador humano envia uma mensagem manual pelo canal. */
  async responderHumano(empresaId: number, id: number, texto: string) {
    const c = await this.detalheConversa(empresaId, id);
    await this.registrar(c.id, 'humano', texto);
    await this.enviar(empresaId, c.telefone, texto);
    await this.prisma.whatsAppConversa.update({ where: { id: c.id }, data: { estado: 'humano' } });
    return { ok: true };
  }

  /** Devolve a conversa ao robô. */
  async devolverAoBot(empresaId: number, id: number) {
    const c = await this.detalheConversa(empresaId, id);
    await this.prisma.whatsAppConversa.update({ where: { id: c.id }, data: { estado: 'bot' } });
    await this.registrar(c.id, 'sistema', 'Conversa devolvida ao robô.');
    return { ok: true };
  }

  // ===== Núcleo: recebe uma mensagem e responde =====
  /** Ponto único de entrada (webhook e simulador chamam aqui). */
  async receberMensagem(empresaId: number, telefone: string, texto: string, nome?: string) {
    const tel = String(telefone || '').replace(/\D/g, '');
    if (!tel) throw new BadRequestException('Telefone inválido.');
    const conversa = await this.prisma.whatsAppConversa.upsert({
      where: { empresaId_telefone: { empresaId, telefone: tel } },
      create: { empresaId, telefone: tel, nome: nome || null },
      update: { ...(nome ? { nome } : {}) },
    });
    await this.registrar(conversa.id, 'cliente', texto);

    // Conversa com humano no comando: robô não responde.
    if (conversa.estado === 'humano') return { estado: 'humano', resposta: null };

    const resposta = await this.pensar(empresaId, conversa.id);
    if (resposta) {
      await this.registrar(conversa.id, 'bot', resposta);
      await this.enviar(empresaId, tel, resposta);
    }
    const atual = await this.prisma.whatsAppConversa.findUnique({ where: { id: conversa.id }, select: { estado: true, pedidoNumero: true } });
    return { estado: atual?.estado ?? 'bot', resposta, pedidoNumero: atual?.pedidoNumero ?? null };
  }

  /** Cérebro do robô: monta o histórico e roda o Claude com as ferramentas. */
  private async pensar(empresaId: number, conversaId: number): Promise<string | null> {
    if (!this.client) {
      return 'Nosso atendente automático está fora do ar no momento. Já avisei a equipe — em breve alguém te responde por aqui. 🙏';
    }
    const conversa = await this.prisma.whatsAppConversa.findUnique({ where: { id: conversaId }, include: { mensagens: { orderBy: { criadoEm: 'asc' }, take: 40 } } });
    if (!conversa) return null;
    const cfg = await this.prisma.whatsAppConfig.findUnique({ where: { empresaId } });

    const tools = this.ferramentas();
    const messages: Anthropic.MessageParam[] = conversa.mensagens
      .filter((m) => m.origem === 'cliente' || m.origem === 'bot')
      .slice(-20)
      .map((m) => ({ role: (m.origem === 'cliente' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.texto }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: '(cliente iniciou a conversa)' });
    }

    try {
      for (let i = 0; i < 6; i++) {
        const resp = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          system: this.systemPrompt(conversa, cfg?.soContrato ?? true),
          tools: tools.map((t) => t.def),
          messages,
        });
        if (resp.stop_reason !== 'tool_use') {
          return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
        }
        messages.push({ role: 'assistant', content: resp.content });
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        for (const bloco of resp.content) {
          if (bloco.type !== 'tool_use') continue;
          const ferr = tools.find((t) => t.def.name === bloco.name);
          let saida: unknown;
          try {
            saida = ferr ? await ferr.run(empresaId, conversa.id, (bloco.input ?? {}) as Record<string, unknown>) : { erro: 'Ferramenta indisponível.' };
          } catch (e) {
            saida = { erro: e instanceof Error ? e.message : 'Falha ao consultar.' };
          }
          resultados.push({ type: 'tool_result', tool_use_id: bloco.id, content: JSON.stringify(saida).slice(0, 8000) });
        }
        messages.push({ role: 'user', content: resultados });
      }
      return 'Vou passar seu atendimento para um de nossos consultores finalizar, tá? Um instante. 🙂';
    } catch (e) {
      this.logger.error(`Erro no cérebro do robô: ${String(e)}`);
      return 'Tive um probleminha aqui. Já chamei a equipe pra te atender. 🙏';
    }
  }

  private systemPrompt(conversa: { nome: string | null; clienteId: number | null }, soContrato: boolean): string {
    return [
      'Você é o assistente comercial da GRUPO CHERKESIAN (uniformes profissionais) no WhatsApp.',
      'Fale em português do Brasil, cordial, objetivo e humano. Use no máximo 2 emojis por mensagem.',
      'OBJETIVO: identificar o cliente, montar um ORÇAMENTO com os produtos e PREÇOS DO CONTRATO dele, confirmar o total, e ao cliente APROVAR, criar o PEDIDO no ERP.',
      soContrato ? 'Atenda com foco em clientes COM CONTRATO (preços já definidos). Se não achar o cliente, peça CNPJ ou nome da empresa; se ainda não identificar, use escalar_humano.' : 'Atenda o cliente e, se preciso, use escalar_humano.',
      'FLUXO: 1) use buscar_cliente para identificar. 2) use produtos_do_cliente para ver os itens e preços do contrato. 3) monte o orçamento na conversa (itens, quantidades, tamanhos, subtotal e TOTAL). 4) confirme com o cliente. 5) quando ele APROVAR claramente, use criar_pedido. 6) informe o número do pedido e diga que a equipe vai finalizar (peça-piloto se aplicável) e produzir.',
      'NUNCA invente preço: use só o que vier de produtos_do_cliente. Se o cliente pedir item que não está no contrato, ou desconto, ou algo fora do padrão, use escalar_humano.',
      'Se o cliente pedir para falar com uma pessoa, use escalar_humano imediatamente.',
      conversa.nome ? `Nome do contato: ${conversa.nome}.` : '',
      conversa.clienteId ? `Cliente já identificado (id ${conversa.clienteId}).` : '',
    ].filter(Boolean).join('\n');
  }

  // ===== Ferramentas do robô =====
  private ferramentas(): Array<{ def: Anthropic.Tool; run: (empresaId: number, conversaId: number, input: Record<string, unknown>) => Promise<unknown> }> {
    return [
      {
        def: {
          name: 'buscar_cliente',
          description: 'Identifica o cliente por CNPJ/CPF, nome ou grupo. Vincula à conversa.',
          input_schema: { type: 'object', properties: { termo: { type: 'string', description: 'CNPJ, CPF, nome ou grupo do cliente' } }, required: ['termo'] },
        },
        run: async (empresaId, conversaId, input) => {
          const termo = String(input.termo || '').trim();
          const doc = termo.replace(/\D/g, '');
          const clientes = await this.prisma.cliente.findMany({
            where: {
              empresaId,
              OR: [
                doc.length >= 11 ? { cnpjCpf: { contains: doc } } : undefined,
                { nome: { contains: termo, mode: 'insensitive' } },
                { fantasia: { contains: termo, mode: 'insensitive' } },
              ].filter(Boolean) as Prisma.ClienteWhereInput[],
            },
            select: { id: true, nome: true, fantasia: true, cnpjCpf: true, grupo: true },
            take: 5,
          });
          if (clientes.length === 1) {
            await this.prisma.whatsAppConversa.update({ where: { id: conversaId }, data: { clienteId: clientes[0].id, nome: clientes[0].fantasia || clientes[0].nome } });
          }
          return { encontrados: clientes.length, clientes };
        },
      },
      {
        def: {
          name: 'produtos_do_cliente',
          description: 'Lista os produtos e preços de contrato do cliente identificado (por clienteId ou grupo).',
          input_schema: { type: 'object', properties: { clienteId: { type: 'number' } }, required: ['clienteId'] },
        },
        run: async (empresaId, _conversaId, input) => {
          const clienteId = Number(input.clienteId);
          const cli = await this.prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { id: true, grupo: true } });
          if (!cli) return { erro: 'Cliente não encontrado.' };
          const prods = await this.prisma.produto.findMany({
            where: { empresaId, OR: [{ clienteId }, cli.grupo ? { clienteGrupo: cli.grupo } : undefined].filter(Boolean) as Prisma.ProdutoWhereInput[] },
            select: { id: true, codigo: true, descricao: true, cor: true, grade: true, precoBase: true, precoEspecial: true, tamsEspeciais: true },
            take: 60,
          });
          return {
            total: prods.length,
            produtos: prods.map((p) => ({
              id: p.id, codigo: p.codigo, descricao: p.descricao, cor: p.cor, grade: p.grade,
              preco: p.precoBase ? Number(p.precoBase) : null,
              precoEspecial: p.precoEspecial ? Number(p.precoEspecial) : null,
              tamanhosEspeciais: p.tamsEspeciais,
            })),
          };
        },
      },
      {
        def: {
          name: 'criar_pedido',
          description: 'Cria o pedido no ERP APÓS o cliente aprovar o orçamento. Retorna o número do pedido.',
          input_schema: {
            type: 'object',
            properties: {
              clienteId: { type: 'number' },
              itens: {
                type: 'array',
                items: { type: 'object', properties: { produtoId: { type: 'number' }, quantidade: { type: 'number' }, tamanho: { type: 'string' } }, required: ['produtoId', 'quantidade'] },
              },
              observacao: { type: 'string' },
            },
            required: ['clienteId', 'itens'],
          },
        },
        run: async (empresaId, conversaId, input) => {
          const clienteId = Number(input.clienteId);
          const itensIn = Array.isArray(input.itens) ? (input.itens as Array<Record<string, unknown>>) : [];
          if (!itensIn.length) return { erro: 'Sem itens.' };
          const cli = await this.prisma.cliente.findFirst({ where: { id: clienteId, empresaId } });
          if (!cli) return { erro: 'Cliente não encontrado.' };
          const prodIds = itensIn.map((i) => Number(i.produtoId)).filter(Boolean);
          const prods = await this.prisma.produto.findMany({ where: { id: { in: prodIds }, empresaId }, select: { id: true, descricao: true, cor: true, precoBase: true } });
          const pmap = new Map(prods.map((p) => [p.id, p]));
          const itens = itensIn.map((i) => {
            const p = pmap.get(Number(i.produtoId));
            const qtd = Math.max(1, Math.round(Number(i.quantidade) || 1));
            const unit = p?.precoBase ? new Prisma.Decimal(p.precoBase) : new Prisma.Decimal(0);
            const tam = i.tamanho ? String(i.tamanho).toUpperCase() : null;
            return {
              produtoId: p?.id,
              descricao: (p?.descricao || 'Item') + (tam ? ` (${tam})` : ''),
              cor: p?.cor ?? undefined,
              quantidade: qtd,
              valorUnit: unit,
              grade: tam ? ({ [tam]: qtd } as Prisma.InputJsonValue) : undefined,
            };
          });
          const total = itens.reduce((s, it) => s.plus(it.valorUnit.mul(it.quantidade)), new Prisma.Decimal(0));
          const nums = (await this.prisma.pedido.findMany({ where: { empresaId }, select: { numero: true } })).map((p) => p.numero);
          const numero = proximoSequencial('PV', nums, { pad: 2 });
          const pedido = await this.prisma.pedido.create({
            data: {
              empresaId, numero, clienteId: cli.id,
              valorTotal: total, status: 'Orçamento', etapa: 'orcamento',
              formaPagamento: 'A combinar (WhatsApp)',
              obs: `Pedido iniciado pelo robô de WhatsApp.${input.observacao ? ' ' + String(input.observacao) : ''}`,
              itens: { create: itens },
            },
          });
          await this.prisma.whatsAppConversa.update({ where: { id: conversaId }, data: { pedidoNumero: pedido.numero, estado: 'humano' } });
          await this.registrar(conversaId, 'sistema', `Pedido ${pedido.numero} criado (R$ ${Number(total).toFixed(2)}). Conversa encaminhada à equipe.`);
          return { ok: true, numero: pedido.numero, total: Number(total.toFixed(2)), itens: itens.length };
        },
      },
      {
        def: {
          name: 'escalar_humano',
          description: 'Encaminha a conversa para um atendente humano finalizar (fora do padrão, desconto, pedido especial, ou a pedido do cliente).',
          input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
        },
        run: async (_empresaId, conversaId, input) => {
          await this.prisma.whatsAppConversa.update({ where: { id: conversaId }, data: { estado: 'humano' } });
          await this.registrar(conversaId, 'sistema', `Encaminhado a humano: ${String(input.motivo || '')}`);
          return { ok: true };
        },
      },
    ];
  }

  // ===== Canal de saída (adapter) =====
  private async enviar(empresaId: number, telefone: string, texto: string): Promise<void> {
    const cfg = await this.prisma.whatsAppConfig.findUnique({ where: { empresaId } });
    const prov = cfg?.provedor ?? 'simulado';
    if (prov === 'simulado' || !cfg?.token || !cfg?.phoneId) {
      this.logger.log(`[SIMULADO→${telefone}] ${texto}`);
      return;
    }
    try {
      if (prov === 'meta') {
        await fetch(`https://graph.facebook.com/v20.0/${cfg.phoneId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: telefone, type: 'text', text: { body: texto } }),
        });
      } else if (prov === 'zapi') {
        await fetch(`https://api.z-api.io/instances/${cfg.phoneId}/token/${cfg.token}/send-text`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: telefone, message: texto }),
        });
      }
    } catch (e) {
      this.logger.error(`Falha ao enviar WhatsApp (${prov}): ${String(e)}`);
    }
  }

  private async registrar(conversaId: number, origem: string, texto: string) {
    await this.prisma.whatsAppMensagem.create({ data: { conversaId, origem, texto: String(texto).slice(0, 4000) } });
    await this.prisma.whatsAppConversa.update({ where: { id: conversaId }, data: { atualizadoEm: new Date() } });
  }
}
