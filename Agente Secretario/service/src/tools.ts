import type Anthropic from '@anthropic-ai/sdk';
import { consultarModulo, modulosDisponiveis } from './erp';
import { lerEmails, lerAgenda } from './google';
import { criarAprovacao } from './approvals';

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

    default:
      return { erro: `Ferramenta "${nome}" não disponível nesta fase.` };
  }
}
