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
    'clientes',
    'medidas',
    'comissoes',
    'precificacao',
    'receber',
    'dashboard',
    'tv',
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
  ],
  chao: ['tv', 'producao', 'piloto', 'estoque'],
  expedicao: ['dashboard', 'tv', 'estoque', 'expedicao'],
  financeiro: ['dashboard', 'tv', 'receber', 'pagar', 'fluxo', 'impostos', 'comissoes'],
};

/** Retorna true se o perfil informado pode acessar a área. */
export function perfilPodeAcessar(acesso: Acesso, area: Area): boolean {
  const areas = ACESSO_AREAS[acesso];
  if (areas === ALL_AREAS) return true;
  return areas.includes(area);
}
