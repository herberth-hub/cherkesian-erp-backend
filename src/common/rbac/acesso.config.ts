import { Acesso } from '@prisma/client';

/**
 * Áreas funcionais do ERP. A proteção de rota é feita por ÁREA (não por perfil),
 * e cada perfil (`Acesso`) enxerga um conjunto de áreas — o mesmo mapa do frontend,
 * agora como fonte de verdade no backend (SPEC §5).
 */
export type Area =
  | 'dashboard'
  | 'tv'
  // DINHEIRO DA EMPRESA: faturamento, margem, inadimplência, caixa — o retrato
  // financeiro do negócio inteiro, não o valor de um pedido. Fica com o dono e
  // com quem toca contas a pagar/receber. Precisa ser área PRÓPRIA porque não dá
  // para derivar de `receber`: o comercial tem `receber` (acompanha a cobrança da
  // carteira dele) e ainda assim não vê o faturamento da empresa.
  | 'diretoria'
  // BI de produtividade: leitura analítica da cadeia produtiva. Área própria
  // porque o menu só oferece a tela ao dono e à consultoria externa — enquanto
  // dependia de `dashboard`, a API também atendia produção, expedição e comercial.
  | 'bi'
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
  // Produção e chão de fábrica NÃO entram no canal de anomalias: ele é o quadro de
  // problemas e trocas do CLIENTE (comercial/expedição/financeiro). Era herança da
  // primeira versão do canal. Uma anomalia com `setor = 'producao'` continua podendo
  // ser roteada, mas quem resolve é o comercial — ver observação no handoff.
  producao: ['pcp', 'producao', 'piloto', 'compras', 'estoque', 'medidas', 'cadastros', 'dashboard', 'tv'],
  chao: ['tv', 'producao', 'piloto', 'estoque'],
  expedicao: ['dashboard', 'tv', 'estoque', 'expedicao', 'anomalias'],
  financeiro: ['dashboard', 'diretoria', 'tv', 'receber', 'pagar', 'fluxo', 'impostos', 'comissoes', 'rh', 'anomalias'],
  // Contabilidade: leitura de tudo que gera relatório fiscal/financeiro + NF-e + RH.
  contabilidade: [
    'dashboard',
    'diretoria',
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
  // SEM `comissoes`: a consultoria não enxerga quanto a casa paga de comissão.
  consultoria: [
    'dashboard',
    'bi',
    'tv',
    'pcp',
    'producao',
    'expedicao',
    'estoque',
    'compras',
    'vendas',
    'clientes',
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

/**
 * O perfil pode ver O DINHEIRO DA EMPRESA?
 *
 * Isto é: faturamento, margem, caixa, inadimplência, curva ABC — o retrato
 * financeiro do negócio. NÃO é o valor de um pedido: o comercial precisa saber
 * quanto custa o que ele está vendendo, e isso continua liberado.
 *
 * Existe como função única porque a regra estava repetida à mão em cada tela
 * que mostra dinheiro, e regra copiada é regra que um dia diverge — bastava
 * esquecer um lugar para o faturamento vazar por ali. Quem responde "sim" é
 * quem tem a área `diretoria`: o dono e quem toca contas a pagar/receber.
 */
export function podeVerDinheiroDaEmpresa(acesso: Acesso): boolean {
  return perfilPodeAcessar(acesso, 'diretoria');
}
