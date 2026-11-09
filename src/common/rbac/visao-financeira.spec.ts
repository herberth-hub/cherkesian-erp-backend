/**
 * QUEM PODE VER O DINHEIRO DA EMPRESA.
 *
 * Regra do dono: o retrato financeiro do negócio — faturamento, margem, caixa,
 * inadimplência, extrato bancário — é do administrador e de quem toca contas a
 * pagar e a receber. Mais ninguém.
 *
 * O que estava furado não era o menu: era a API. Esconder uma tela do menu
 * ARRUMA A TELA, não controla acesso. Quem soubesse a URL passava:
 *
 *   - /dashboard/indices e /dashboard/drill (Painel do Diretor: faturado no mês,
 *     mês anterior, a receber, inadimplência, ticket médio, pipeline) exigiam só
 *     a área `dashboard`, que comercial, vendedor, produção, expedição e
 *     consultoria têm;
 *   - /bi/producao devolvia faturamento por CNPJ e mês a mês pela mesma área;
 *   - /bancos/extrato aceitava `receber`, e o comercial TEM `receber` para
 *     acompanhar a cobrança da carteira dele — então lia o extrato da conta da
 *     empresa inteira;
 *   - o assistente de IA respondia "total a receber em aberto" a quem
 *     perguntasse, pela mesma área `dashboard`.
 *
 * Este teste fixa a regra por PERFIL. Se alguém der uma área a mais a um perfil,
 * ou afrouxar um endpoint, quebra aqui.
 */
import { Acesso } from '@prisma/client';
import { ACESSO_AREAS, Area, perfilPodeAcessar, podeVerDinheiroDaEmpresa } from './acesso.config';

const TODOS = Object.keys(ACESSO_AREAS) as Acesso[];

/** Quem o dono autorizou: ele mesmo + contas a pagar/receber. */
const COM_VISAO_FINANCEIRA: Acesso[] = ['total', 'financeiro', 'contabilidade'];
const SEM_VISAO_FINANCEIRA = TODOS.filter((a) => !COM_VISAO_FINANCEIRA.includes(a));

describe('visão financeira da empresa', () => {
  it('a lista de perfis não mudou sem este teste saber', () => {
    expect(TODOS.sort()).toEqual(
      ['chao', 'cliente', 'comercial', 'consultoria', 'contabilidade', 'expedicao', 'financeiro', 'producao', 'total', 'vendedor'].sort(),
    );
  });

  describe('quem PODE', () => {
    it.each(COM_VISAO_FINANCEIRA)('%s vê o dinheiro da empresa', (acesso) => {
      expect(podeVerDinheiroDaEmpresa(acesso)).toBe(true);
    });
  });

  describe('quem NÃO pode', () => {
    it.each(SEM_VISAO_FINANCEIRA)('%s NÃO vê o dinheiro da empresa', (acesso) => {
      expect(podeVerDinheiroDaEmpresa(acesso)).toBe(false);
    });

    it('inclui o comercial, que tem `receber` e ainda assim não vê o caixa', () => {
      // É este o par que derrubava a trava antiga: acompanhar a cobrança da
      // carteira não é enxergar o dinheiro da casa.
      expect(perfilPodeAcessar('comercial', 'receber')).toBe(true);
      expect(podeVerDinheiroDaEmpresa('comercial')).toBe(false);
    });

    it('inclui a consultoria, que usa o BI e não vê faturamento', () => {
      expect(perfilPodeAcessar('consultoria', 'bi')).toBe(true);
      expect(podeVerDinheiroDaEmpresa('consultoria')).toBe(false);
    });
  });

  describe('as áreas que guardam cada endpoint', () => {
    /** Mesma leitura do guard: basta UMA das áreas. */
    const alcanca = (acesso: Acesso, exige: Area[]) => exige.some((a) => perfilPodeAcessar(acesso, a));

    it('Painel do Diretor (/dashboard/indices e /drill) só para quem vê dinheiro', () => {
      for (const acesso of TODOS) {
        expect(alcanca(acesso, ['diretoria'])).toBe(COM_VISAO_FINANCEIRA.includes(acesso));
      }
    });

    it('extrato bancário (/bancos/extrato) fora do alcance de quem só tem `receber`', () => {
      const exige: Area[] = ['pagar', 'fluxo'];
      expect(alcanca('comercial', exige)).toBe(false);
      expect(alcanca('vendedor', exige)).toBe(false);
      expect(alcanca('producao', exige)).toBe(false);
      expect(alcanca('expedicao', exige)).toBe(false);
      expect(alcanca('consultoria', exige)).toBe(false);
      for (const acesso of COM_VISAO_FINANCEIRA) expect(alcanca(acesso, exige)).toBe(true);
    });

    it('BI só para o dono e a consultoria — não para produção nem comercial', () => {
      expect(alcanca('total', ['bi'])).toBe(true);
      expect(alcanca('consultoria', ['bi'])).toBe(true);
      for (const acesso of ['comercial', 'vendedor', 'producao', 'expedicao'] as Acesso[]) {
        expect(alcanca(acesso, ['bi'])).toBe(false);
      }
    });

    it('o dashboard comum continua aberto — é lá que mora o anti-atraso', () => {
      // A trava é sobre DINHEIRO, não sobre operação: tirar o dashboard da
      // produção quebraria o acompanhamento de pedido atrasado.
      for (const acesso of ['comercial', 'producao', 'expedicao', 'consultoria'] as Acesso[]) {
        expect(perfilPodeAcessar(acesso, 'dashboard')).toBe(true);
      }
    });
  });

  it('nenhum perfil sem visão financeira carrega a área `diretoria` por engano', () => {
    for (const acesso of SEM_VISAO_FINANCEIRA) {
      const areas = ACESSO_AREAS[acesso];
      if (areas === '*') throw new Error(`${acesso} não deveria ter todas as áreas`);
      expect(areas).not.toContain('diretoria');
    }
  });
});
