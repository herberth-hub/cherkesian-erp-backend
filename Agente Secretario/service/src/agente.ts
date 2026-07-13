import Anthropic from '@anthropic-ai/sdk';
import { cfg, exigirIA } from './config';
import { systemPrompt } from './prompt';
import { TOOLS_FASE1, executarTool } from './tools';

export interface ResultadoAgente {
  resposta: string;
  ferramentas_usadas: string[];
}

/**
 * Roda o agente sobre uma instrução, com o loop de tool use da Claude API:
 * o modelo pede uma ferramenta → executamos → devolvemos o resultado → repete
 * até a resposta final. Na Fase 1, todas as ferramentas são de leitura.
 *
 * `onEvento` (opcional) recebe avisos de progresso (ex.: qual tool foi chamada).
 */
export async function runAgente(
  instrucao: string,
  onEvento?: (msg: string) => void,
): Promise<ResultadoAgente> {
  exigirIA();
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  const usadas: string[] = [];

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: instrucao }];

  for (let i = 0; i < 10; i++) {
    const resp = await client.messages.create({
      model: cfg.model,
      max_tokens: 4096,
      system: systemPrompt(),
      tools: TOOLS_FASE1,
      messages,
    });

    if (resp.stop_reason !== 'tool_use') {
      const texto = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { resposta: texto || 'Não consegui elaborar uma resposta.', ferramentas_usadas: usadas };
    }

    messages.push({ role: 'assistant', content: resp.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloco of resp.content) {
      if (bloco.type !== 'tool_use') continue;
      usadas.push(bloco.name);
      onEvento?.(`🔧 ${bloco.name}(${JSON.stringify(bloco.input)})`);
      let saida: unknown;
      try {
        saida = await executarTool(bloco.name, (bloco.input ?? {}) as Record<string, unknown>);
      } catch (e) {
        saida = { erro: e instanceof Error ? e.message : 'Falha ao executar a ferramenta.' };
      }
      resultados.push({
        type: 'tool_result',
        tool_use_id: bloco.id,
        content: JSON.stringify(saida).slice(0, 16000),
      });
    }
    messages.push({ role: 'user', content: resultados });
  }

  return {
    resposta: 'A tarefa exigiu muitos passos. Reformule de forma mais específica, por favor.',
    ferramentas_usadas: usadas,
  };
}
