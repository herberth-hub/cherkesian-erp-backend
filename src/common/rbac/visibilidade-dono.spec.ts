/**
 * QUEM VÊ O DINHEIRO.
 *
 * Duas camadas, e a segunda existe porque a primeira não bastava: o perfil
 * `total` é de CINCO logins (admin, bruna, marcelo, ISRAEL.LUCAS e o assistente
 * de IA), e o custo da peça e o contas a pagar/receber são de dois deles.
 *
 * Os nomes abaixo são os logins reais do banco em 17/11/2026, de propósito. Se
 * alguém trocar a lista sem pensar, é um destes testes que cai — e não a Bruna
 * descobrindo a margem de cada produto na segunda-feira.
 */
import { Acesso } from '@prisma/client';
import {
  AREAS_DO_DONO, LOGINS_DONO, ehLoginDoDono, perfilPodeAcessar, podeVerCusto, podeVerFinanceiro,
} from './acesso.config';

const u = (usuario: string, acesso: Acesso) => ({ usuario, acesso });

const ADMIN = u('admin', 'total');
const IA = u('agente', 'total');
const BRUNA = u('bruna', 'total');
const MARCELO = u('marcelo', 'total');
const ISRAEL = u('ISRAEL.LUCAS', 'total');
const DELTACONT = u('DELTACONT', 'contabilidade');
const SABRINA = u('sabrina', 'vendedor');
const PRODUCAO = u('producao', 'producao');

describe('o custo da peca e do material', () => {
  it('o Herberth e a IA veem', () => {
    expect(podeVerCusto(ADMIN)).toBe(true);
    expect(podeVerCusto(IA)).toBe(true);
  });

  it('os OUTROS "total" NAO veem — e e este o ponto da trava', () => {
    for (const x of [BRUNA, MARCELO, ISRAEL]) expect(podeVerCusto(x)).toBe(false);
  });

  it('nem a contabilidade ve custo: margem de produto nao e assunto do escritorio', () => {
    expect(podeVerCusto(DELTACONT)).toBe(false);
  });

  it('ninguem mais ve', () => {
    for (const x of [SABRINA, PRODUCAO, null, undefined, u('', 'total')]) expect(podeVerCusto(x as never)).toBe(false);
  });

  it('o login nao diferencia maiuscula de minuscula', () => {
    expect(ehLoginDoDono('ADMIN')).toBe(true);
    expect(ehLoginDoDono(' Admin ')).toBe(true);
  });

  it('login parecido nao entra', () => {
    for (const x of ['admin2', 'administrador', 'adm', 'agentes', 'xadmin']) expect(ehLoginDoDono(x)).toBe(false);
  });
});

describe('contas a pagar e a receber', () => {
  it('o Herberth e a IA veem', () => {
    expect(podeVerFinanceiro(ADMIN)).toBe(true);
    expect(podeVerFinanceiro(IA)).toBe(true);
  });

  it('a contabilidade continua vendo — e o trabalho dela', () => {
    expect(podeVerFinanceiro(DELTACONT)).toBe(true);
  });

  it('o perfil financeiro continua vendo', () => {
    expect(podeVerFinanceiro(u('qualquer', 'financeiro'))).toBe(true);
  });

  it('os outros "total" NAO veem', () => {
    for (const x of [BRUNA, MARCELO, ISRAEL]) expect(podeVerFinanceiro(x)).toBe(false);
  });

  it('producao, expedicao, vendedor e consultoria nao veem', () => {
    for (const a of ['producao', 'expedicao', 'vendedor', 'consultoria', 'chao', 'cliente'] as Acesso[]) {
      expect(podeVerFinanceiro(u('alguem', a))).toBe(false);
    }
  });
});

describe('o comercial perdeu contas a receber no perfil, nao so na tela', () => {
  it('o perfil nao enxerga mais a area', () => {
    expect(perfilPodeAcessar('comercial', 'receber')).toBe(false);
  });

  it('mas continua com a venda, a carteira e a comissao', () => {
    for (const a of ['vendas', 'crm', 'clientes', 'comissoes', 'precificacao'] as const) {
      expect(perfilPodeAcessar('comercial', a)).toBe(true);
    }
  });
});

describe('as areas que a trava cobre', () => {
  it('sao contas a receber e a pagar', () => {
    expect([...AREAS_DO_DONO].sort()).toEqual(['pagar', 'receber']);
  });

  it('fluxo de caixa NAO esta na lista — o Herberth pediu pagar e receber', () => {
    expect(AREAS_DO_DONO).not.toContain('fluxo');
  });

  it('a lista de logins e curta e explicita', () => {
    expect([...LOGINS_DONO].sort()).toEqual(['admin', 'agente']);
  });
});
