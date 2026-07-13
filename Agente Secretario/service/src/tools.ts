import type Anthropic from '@anthropic-ai/sdk';
import { consultarModulo, modulosDisponiveis } from './erp';
import { lerEmails, lerAgenda } from './google';
import { criarAprovacao } from './approvals';
import { gerarDocumento } from './erp-actions';

/** Tipos de documento que o ERP sabe gerar (PDF timbrado). */
const DOC_TIPOS = ['proposta', 'pedido', 'op', 'pedido_compra', 'romaneio', 'ficha_medidas', 'ficha_tecnica'];

/**
 * Ferramentas ativas nas FASES 1–2.
 * 🟢 verde (leitura): erp_consultar, ler_emails, ler_agenda — executam direto.
 * 🟡 amarelo (redação/proposta): redigir_email, agendar_reuniao — NÃO executam;
 *    registram uma proposta PENDENTE na fila de aprovações. O envio/agendamento
 *    só ocorre depois que o Herberth aprova pelo CLI.
 */
export const TOOLS_ATIVAS: Anthropic.Tool[] = [
  {
    name: 'erp_consultar',
    description:
      'Leitura de qualquer módulo do ERP Cherkesian. Módulos: ' +
      modulosDisponiveis().join(', ') +
      '. Retorna dados reais (JSON). Use filtros quando útil (ex.: {"limite": 20}).',
    input_schema: {
      type: 'object',
      properties: {
        modulo: { type: 'string', description: 'Nome do módulo (ex.: dashboard, receber, pagar, produtos).' },
        filtros: { type: 'object', description: 'Filtros opcionais em query string.' },
      },
      required: ['modulo'],
    },
  },
  {
    name: 'ler_emails',
    description: 'Lista e resume e-mails da caixa de entrada (somente leitura). Requer Google conectado.',
    input_schema: {
      type: 'object',
      properties: {
        filtro: { type: 'string', description: "Ex.: 'nao lidos', 'de:cliente@x.com', 'urgentes'." },
        periodo: { type: 'string', description: "Ex.: 'hoje', 'esta semana', '2026-07-13'." },
      },
    },
  },
  {
    name: 'ler_agenda',
    description: 'Lê o Google Calendar: eventos no período (somente leitura). Requer Google conectado.',
    input_schema: {
      type: 'object',
      properties: { periodo: { type: 'string', description: "Ex.: 'hoje', 'esta semana', '2026-07-13'." } },
      required: ['periodo'],
    },
  },
  {
    name: 'redigir_email',
    description:
      'Prepara um RASCUNHO de e-mail no tom da empresa (assine como "Grupo Cherkesian"). ' +
      'NÃO envia — registra uma proposta que fica PENDENTE até o Herberth aprovar. ' +
      'Escreva o corpo completo do e-mail em `corpo`.',
    input_schema: {
      type: 'object',
      properties: {
        para: { type: 'string', description: 'E-mail(s) do destinatário.' },
        assunto: { type: 'string' },
        corpo: { type: 'string', description: 'Texto completo do e-mail, pronto para envio.' },
      },
      required: ['para', 'assunto', 'corpo'],
    },
  },
  {
    name: 'agendar_reuniao',
    description:
      'Propõe um evento no Google Calendar com convites. NÃO cria na hora — registra uma proposta ' +
      'PENDENTE até o Herberth aprovar. Informe data/hora em ISO 8601.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        quando: { type: 'string', description: 'Início em ISO 8601 (ex.: 2026-07-15T14:00:00).' },
        duracao_min: { type: 'integer', description: 'Duração em minutos (padrão 30).' },
        convidados: { type: 'array', items: { type: 'string' }, description: 'E-mails dos convidados.' },
        descricao: { type: 'string' },
      },
      required: ['titulo', 'quando'],
    },
  },

  // ===== Fase 3 — ERP ativo (🟡 exceto gerar_documento) =====
  {
    name: 'erp_gerar_documento',
    description:
      'Gera um documento em PDF timbrado no ERP e devolve a URL para revisão. Tipos: ' +
      DOC_TIPOS.join(', ') +
      '. Executa direto (é material de apoio; não envia nada a ninguém). ref_id = id do pedido/OP/expedição/cliente conforme o tipo.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: DOC_TIPOS },
        ref_id: { type: 'integer', description: 'Id da referência (pedido/OP/expedição/cliente).' },
      },
      required: ['tipo', 'ref_id'],
    },
  },
  {
    name: 'erp_gerar_op',
    description:
      'PROPÕE gerar a Ordem de Produção de um pedido (checa piloto e material; se faltar, cria ordem de compra). ' +
      'NÃO executa na hora — vira proposta PENDENTE até o Herberth aprovar.',
    input_schema: {
      type: 'object',
      properties: { pedido_id: { type: 'integer', description: 'Id do pedido (veja em erp_consultar módulo pedidos).' } },
      required: ['pedido_id'],
    },
  },
  {
    name: 'erp_gerar_ordem_compra',
    description:
      'PROPÕE criar uma ordem de compra a um fornecedor. NÃO executa — vira proposta PENDENTE. ' +
      'Informe fornecedor_id e material_id (veja em erp_consultar módulos fornecedores/materiais).',
    input_schema: {
      type: 'object',
      properties: {
        fornecedor_id: { type: 'integer' },
        descricao: { type: 'string' },
        quantidade: { type: 'number' },
        unidade: { type: 'string', description: "Ex.: 'm', 'un', 'kg'." },
        valor: { type: 'number', description: 'Valor total da compra (R$).' },
        material_id: { type: 'integer' },
        previsao: { type: 'string', description: 'Previsão de entrega ISO-8601 (opcional).' },
        motivo: { type: 'string' },
      },
      required: ['fornecedor_id', 'descricao', 'quantidade', 'unidade', 'valor'],
    },
  },
  {
    name: 'emitir_nfe',
    description:
      'PROPÕE emitir a NF-e de uma EXPEDIÇÃO (pelo provedor configurado no ERP). NÃO emite na hora — ' +
      'vira proposta PENDENTE até o Herberth aprovar. Informe o id da expedição (veja em erp_consultar módulo expedicao).',
    input_schema: {
      type: 'object',
      properties: { expedicao_id: { type: 'integer' } },
      required: ['expedicao_id'],
    },
  },
  {
    name: 'enviar_documento_email',
    description:
      'PROPÕE gerar um documento (proposta/pedido/pedido_compra/etc.) e enviá-lo por e-mail com o PDF anexo ' +
      '(via ERP). NÃO envia na hora — vira proposta PENDENTE até o Herberth aprovar.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: DOC_TIPOS },
        ref_id: { type: 'integer' },
        para: { type: 'string', description: 'E-mail do destinatário.' },
        assunto: { type: 'string' },
        mensagem: { type: 'string', description: 'Mensagem opcional no corpo.' },
      },
      required: ['tipo', 'ref_id', 'para'],
    },
  },
];

const AVISO_PENDENTE =
  'Proposta registrada e PENDENTE. NÃO foi enviada/agendada. Informe ao Herberth que a proposta ' +
  'aguarda aprovação (ele decide com `npm run aprovar -- <id>`). Não diga que já foi feito.';

/** Executa a ferramenta pedida pelo modelo. As amarelas apenas enfileiram. */
export async function executarTool(nome: string, input: Record<string, unknown>): Promise<unknown> {
  switch (nome) {
    case 'erp_consultar':
      return consultarModulo(String(input.modulo ?? ''), (input.filtros as Record<string, unknown>) || undefined);
    case 'ler_emails':
      return lerEmails(input.filtro as string | undefined, input.periodo as string | undefined);
    case 'ler_agenda':
      return lerAgenda(String(input.periodo ?? 'hoje'));

    case 'redigir_email': {
      const para = String(input.para ?? '').trim();
      const assunto = String(input.assunto ?? '').trim();
      const corpo = String(input.corpo ?? '').trim();
      if (!para || !corpo) return { erro: 'Informe destinatário e corpo do e-mail.' };
      const a = criarAprovacao('email', `E-mail para ${para} — "${assunto}"`, { para, assunto, corpo });
      return { proposta_registrada: true, id: a.id, resumo: a.resumo, aviso: AVISO_PENDENTE };
    }

    case 'agendar_reuniao': {
      const titulo = String(input.titulo ?? '').trim();
      const quando = String(input.quando ?? '').trim();
      if (!titulo || !quando) return { erro: 'Informe título e data/hora (ISO 8601).' };
      const dados = {
        titulo,
        quando,
        duracao_min: Number(input.duracao_min ?? 30),
        convidados: Array.isArray(input.convidados) ? input.convidados : [],
        descricao: input.descricao ? String(input.descricao) : undefined,
      };
      const a = criarAprovacao('reuniao', `Reunião "${titulo}" em ${quando}`, dados);
      return { proposta_registrada: true, id: a.id, resumo: a.resumo, aviso: AVISO_PENDENTE };
    }

    // ===== Fase 3 =====
    case 'erp_gerar_documento': {
      const tipo = String(input.tipo ?? '').trim();
      const refId = Number(input.ref_id);
      if (!tipo || !refId) return { erro: 'Informe tipo e ref_id.' };
      try {
        const d = await gerarDocumento(tipo, refId);
        return { gerado: true, numero: d.numero, url_pdf: d.urlPdf };
      } catch (e) {
        return { erro: e instanceof Error ? e.message : 'Falha ao gerar documento.' };
      }
    }

    case 'erp_gerar_op': {
      const pedidoId = Number(input.pedido_id);
      if (!pedidoId) return { erro: 'Informe pedido_id.' };
      const a = criarAprovacao('op', `Gerar OP do pedido #${pedidoId}`, { pedidoId });
      return { proposta_registrada: true, id: a.id, resumo: a.resumo, aviso: AVISO_PENDENTE };
    }

    case 'erp_gerar_ordem_compra': {
      const fornecedorId = Number(input.fornecedor_id);
      const descricao = String(input.descricao ?? '').trim();
      const quantidade = Number(input.quantidade);
      const unidade = String(input.unidade ?? '').trim();
      const valor = Number(input.valor);
      if (!fornecedorId || !descricao || !(quantidade > 0) || !unidade || !(valor > 0)) {
        return { erro: 'Informe fornecedor_id, descricao, quantidade>0, unidade e valor>0.' };
      }
      const dados = {
        fornecedorId,
        descricao,
        quantidade,
        unidade,
        valor,
        materialId: input.material_id ? Number(input.material_id) : undefined,
        previsao: input.previsao ? String(input.previsao) : undefined,
        motivo: input.motivo ? String(input.motivo) : undefined,
      };
      const a = criarAprovacao('ordem_compra', `Ordem de compra a fornecedor #${fornecedorId} — ${descricao} (R$ ${valor.toFixed(2)})`, dados);
      return { proposta_registrada: true, id: a.id, resumo: a.resumo, aviso: AVISO_PENDENTE };
    }

    case 'emitir_nfe': {
      const expedicaoId = Number(input.expedicao_id);
      if (!expedicaoId) return { erro: 'Informe expedicao_id.' };
      const a = criarAprovacao('nfe', `Emitir NF-e da expedição #${expedicaoId}`, { expedicaoId });
      return { proposta_registrada: true, id: a.id, resumo: a.resumo, aviso: AVISO_PENDENTE };
    }

    case 'enviar_documento_email': {
      const tipo = String(input.tipo ?? '').trim();
      const refId = Number(input.ref_id);
      const para = String(input.para ?? '').trim();
      if (!tipo || !refId || !para) return { erro: 'Informe tipo, ref_id e para (e-mail).' };
      const dados = {
        tipo,
        refId,
        para,
        assunto: input.assunto ? String(input.assunto) : undefined,
        mensagem: input.mensagem ? String(input.mensagem) : undefined,
      };
      const a = criarAprovacao('email_documento', `Enviar ${tipo} #${refId} por e-mail para ${para}`, dados);
      return { proposta_registrada: true, id: a.id, resumo: a.resumo, aviso: AVISO_PENDENTE };
    }

    default:
      return { erro: `Ferramenta "${nome}" não disponível nesta fase.` };
  }
}
