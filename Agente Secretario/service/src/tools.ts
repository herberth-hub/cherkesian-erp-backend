import type Anthropic from '@anthropic-ai/sdk';
import { consultarModulo, modulosDisponiveis } from './erp';
import { lerEmails, lerAgenda } from './google';

/**
 * Ferramentas da FASE 1 (nível VERDE — somente leitura).
 * As de escrita (amarelo/vermelho) entram nas fases seguintes.
 */
export const TOOLS_FASE1: Anthropic.Tool[] = [
  {
    name: 'erp_consultar',
    description:
      'Leitura de qualquer módulo do ERP Cherkesian. Módulos: ' +
      modulosDisponiveis().join(', ') +
      '. Retorna os dados reais (JSON). Use filtros quando útil (ex.: {"somente_vencidos": true}).',
    input_schema: {
      type: 'object',
      properties: {
        modulo: { type: 'string', description: 'Nome do módulo (ex.: dashboard, receber, pagar, produtos, estoque).' },
        filtros: { type: 'object', description: 'Filtros opcionais em query string (ex.: { "limite": 20 }).' },
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
    description: 'Lê o Google Calendar: eventos e horários no período (somente leitura). Requer Google conectado.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: "Ex.: 'hoje', 'esta semana', '2026-07-13'." },
      },
      required: ['periodo'],
    },
  },
];

/** Executa a ferramenta pedida pelo modelo e devolve o resultado (JSON serializável). */
export async function executarTool(nome: string, input: Record<string, unknown>): Promise<unknown> {
  switch (nome) {
    case 'erp_consultar':
      return consultarModulo(String(input.modulo ?? ''), (input.filtros as Record<string, unknown>) || undefined);
    case 'ler_emails':
      return lerEmails(input.filtro as string | undefined, input.periodo as string | undefined);
    case 'ler_agenda':
      return lerAgenda(String(input.periodo ?? 'hoje'));
    default:
      return { erro: `Ferramenta "${nome}" não disponível na Fase 1 (somente leitura).` };
  }
}
