import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * Fila de aprovações (human-in-the-loop). As tools amarelas/vermelhas NÃO executam:
 * elas registram uma proposta PENDENTE aqui. O Herberth aprova/recusa pelo CLI
 * (`npm run aprovacoes`, `npm run aprovar -- <id>`), e só então a ação efetiva.
 * O modelo NUNCA marca uma proposta como aprovada por conta própria.
 */

export type AprovacaoTipo =
  | 'email'
  | 'reuniao'
  | 'op'
  | 'ordem_compra'
  | 'nfe'
  | 'email_documento';
export type AprovacaoStatus = 'pendente' | 'aprovada' | 'recusada' | 'erro';

export interface Aprovacao {
  id: string;
  tipo: AprovacaoTipo;
  nivel: 'amarelo' | 'vermelho';
  status: AprovacaoStatus;
  resumo: string;
  dados: Record<string, unknown>;
  criadoEm: string;
  decididoEm?: string;
  resultado?: string;
}

const ARQUIVO = process.env.APROVACOES_PATH || 'aprovacoes.json';

function ler(): Aprovacao[] {
  if (!existsSync(ARQUIVO)) return [];
  try {
    return JSON.parse(readFileSync(ARQUIVO, 'utf8')) as Aprovacao[];
  } catch {
    return [];
  }
}

function salvar(lista: Aprovacao[]): void {
  writeFileSync(ARQUIVO, JSON.stringify(lista, null, 2), 'utf8');
}

export function criarAprovacao(
  tipo: AprovacaoTipo,
  resumo: string,
  dados: Record<string, unknown>,
  nivel: 'amarelo' | 'vermelho' = 'amarelo',
): Aprovacao {
  const lista = ler();
  const a: Aprovacao = {
    id: `${tipo.slice(0, 3)}-${randomBytes(3).toString('hex')}`,
    tipo,
    nivel,
    status: 'pendente',
    resumo,
    dados,
    criadoEm: new Date().toISOString(),
  };
  lista.push(a);
  salvar(lista);
  return a;
}

export function listarPendentes(): Aprovacao[] {
  return ler().filter((a) => a.status === 'pendente');
}

export function obter(id: string): Aprovacao | undefined {
  return ler().find((a) => a.id === id);
}

export function atualizar(id: string, patch: Partial<Aprovacao>): Aprovacao | null {
  const lista = ler();
  const i = lista.findIndex((a) => a.id === id);
  if (i < 0) return null;
  lista[i] = { ...lista[i], ...patch };
  salvar(lista);
  return lista[i];
}
