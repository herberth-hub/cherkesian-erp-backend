import { Acesso } from '@prisma/client';

/**
 * Áreas funcionais do ERP. A proteção de rota é feita por ÁREA (não por perfil),
 * e cada perfil (`Acesso`) enxerga um conjunto de áreas — o mesmo mapa do frontend,
 * agora como fonte de verdade no backend (SPEC §5).
 */
export type Area =
  | 'dashboard'
  | 'tv'
  | 'vendas'
  | 'crm'
  | 'clientes'
  | 'medidas'
  | 'comissoes'
  | 'precificacao'
  | 'receber'
  | 'pagar'
  | 'fluxo'
  | 'impostos'
  | 'pcp'
  | 'producao'
  | 'piloto'
  | 'compras'
  | 'estoque'
  | 'expedicao'
  | 'cadastros'
  | 'rh'
  // canal de anomalias de pedido — compartilhado por quem abre, decide e executa:
  | 'anomalias'
  // portal externo — o próprio cliente enxerga só o estoque/prazos DELE:
  | 'portal'
  // áreas administrativas — só o perfil `total` possui:
  | 'usuarios'
  | 'logs';

/** Curinga: o perfil enxerga todas as áreas. */
export const ALL_AREAS = '*' as const;

/**
 * Mapa perfil -> áreas permitidas (SPEC §5).
 * `total` = acesso irrestrito (inclui áreas administrativas: usuarios, logs).
 */
export const ACESSO_AREAS: Record<Acesso, readonly Area[] | typeof ALL_AREAS> = {
  total: ALL_AREAS,
  comercial: [
    'vendas',
    'crm',
    'clientes',
    'medidas',
    'comissoes',
    'precificacao',
    'receber',
    'dashboard',
    'tv',
    'anomalias',
  ],
  // Vendedor: carteira própria (CRM/funil, orçamentos, comissões e vendas dele).
  // O escopo "só o que é dele" é aplicado nos serviços (pedidos/comissões/leads).
  vendedor: [
    'crm',
    'vendas',
    'clientes',
    'comissoes',
    'medidas',
    'dashboard',
    'tv',
    'anomalias',
  ],
  producao: [
    'pcp',
    'producao',
    'piloto',
    'compras',
    'estoque',
    'medidas',
    'cadastros',
    'dashboard',
    'tv',
    'anomalias',
  ],
  chao: ['tv', 'producao', 'piloto', 'estoque', 'anomalias'],
  expedicao: ['dashboard', 'tv', 'estoque', 'expedicao', 'anomalias'],
  financeiro: ['dashboard', 'tv', 'receber', 'pagar', 'fluxo', 'impostos', 'comissoes', 'rh', 'anomalias'],
  // Contabilidade: leitura de tudo que gera relatório fiscal/financeiro + NF-e + RH.
  contabilidade: [
    'dashboard',
    'tv',
    'receber',
    'pagar',
    'fluxo',
    'impostos',
    'comissoes',
    'vendas',
    'clientes',
    'compras',
    'estoque',
    'expedicao',
    'rh',
    'anomalias',
  ],
  // Consultoria: leitura ampla p/ BI de produtividade da cadeia produtiva.
  consultoria: [
    'dashboard',
    'tv',
    'pcp',
    'producao',
    'expedicao',
    'estoque',
    'compras',
    'vendas',
    'clientes',
    'comissoes',
    'anomalias',
  ],
  // Cliente (portal externo): NÃO enxerga nada interno — só o portal dele.
  cliente: ['portal'],
};

/** Retorna true se o perfil informado pode acessar a área. */
export function perfilPodeAcessar(acesso: Acesso, area: Area): boolean {
  const areas = ACESSO_AREAS[acesso];
  if (areas === ALL_AREAS) return true;
  return areas.includes(area);
}
