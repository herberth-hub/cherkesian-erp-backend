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
  // SEM `receber` desde 17/11/2026: contas a receber passou a ser do dono e do
  // financeiro. O comercial acompanha a cobrança da carteira dele pela própria
  // tela de pedidos, que mostra o que está pago e o que não está.
  comercial: [
    'vendas',
    'crm',
    'clientes',
    'medidas',
    'comissoes',
    'precificacao',
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

// ===========================================================================
// TRAVA POR LOGIN — acima do perfil
// ===========================================================================
/**
 * POR QUE ISTO NÃO É UM PERFIL.
 *
 * O perfil `total` é de cinco pessoas (admin, bruna, marcelo, ISRAEL.LUCAS e o
 * login do assistente de IA). O que a peça CUSTA e o CONTAS A PAGAR/RECEBER não
 * são de todas elas — decisão do Herberth em 17/11/2026: "apenas o perfil do adm
 * e a IA podem ver".
 *
 * Criar um perfil novo para isso obrigaria a remanejar os outros quatro e
 * mudaria tudo o que eles já fazem. A trava por LOGIN fica acima do perfil e
 * mexe só no que precisa mexer.
 *
 * O preço disso: `scripts/rbac-check.js` compara MENU × PERFIL e não enxerga
 * esta camada. Por isso o frontend esconde as mesmas telas pelo mesmo critério
 * — se um dia divergirem, o menu oferece e a API nega.
 *
 * Trocar o login do Herberth (hoje `admin`) sem mexer aqui FECHA o acesso dele.
 */
export const LOGINS_DONO: readonly string[] = ['admin', 'agente'];

/** Áreas que, além do perfil, exigem um login desta lista (ou perfil financeiro). */
export const AREAS_DO_DONO: readonly Area[] = ['receber', 'pagar'];

/**
 * Perfis que continuam vendo o financeiro mesmo não sendo login do dono.
 *
 * A DELTACONT (contabilidade) toca contas a pagar e a receber — é o trabalho
 * dela. Cortá-la junto deixaria o escritório pedindo os números por WhatsApp.
 */
const PERFIS_FINANCEIROS: readonly Acesso[] = ['financeiro', 'contabilidade'];

export function ehLoginDoDono(usuario: string | null | undefined): boolean {
  const u = String(usuario ?? '').trim().toLowerCase();
  return !!u && LOGINS_DONO.some((d) => d.toLowerCase() === u);
}

/** Contas a pagar e a receber. */
export function podeVerFinanceiro(user: { usuario?: string | null; acesso?: Acesso } | null | undefined): boolean {
  if (!user) return false;
  if (ehLoginDoDono(user.usuario)) return true;
  return !!user.acesso && PERFIS_FINANCEIROS.includes(user.acesso);
}

/**
 * O que a PEÇA custa e o que o MATERIAL custa.
 *
 * Mais fechado que o financeiro: nem a contabilidade entra. Saber a margem de
 * cada produto é o que se leva embora ao sair da empresa.
 */
export function podeVerCusto(user: { usuario?: string | null } | null | undefined): boolean {
  return ehLoginDoDono(user?.usuario);
}
