/**
 * TELAS QUE SE ATUALIZAM SOZINHAS.
 *
 * O líder de produção movimentava uma OP e, para ele, a OP aparecia movimentada.
 * Para os colegas, não. O dado sempre esteve CERTO no banco (conferido: a
 * gradeFases e o setorAtual gravam, e a consulta da lista filtra só por empresa,
 * sem nenhum recorte por usuário). O que faltava era a tela buscar de novo:
 * quem já estava com a Produção aberta ficava olhando a foto do momento em que
 * entrou, até trocar de tela ou dar F5.
 *
 * A correção faz as telas operacionais recarregarem sozinhas. O risco de uma
 * tela que se recarrega é atropelar quem está trabalhando — por isso existem
 * travas, e são ELAS que este teste prende. Se alguém afrouxar uma delas, o
 * usuário perde o que estava digitando; se alguém apertar demais, a tela volta
 * a ficar parada e o bug ressuscita.
 *
 * O código testado é extraído do public/index.html, não copiado: o teste roda a
 * função que está no ar.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

type Ambiente = {
  rota: string;
  escondida?: boolean;
  janelaAberta?: boolean;
  janelaMinimizada?: boolean;
  arrastando?: boolean;
  focoEm?: string | null;
  selecao?: string;
};

/** Pega o bloco de auto-refresh que está no index.html de verdade. */
function codigoDoBloco(): string {
  const html = readFileSync(join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const ini = html.indexOf('// ===== TELAS QUE SE ATUALIZAM SOZINHAS =====');
  const fim = html.indexOf('async function loadRoute(');
  expect(ini).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(ini);
  return html.slice(ini, fim);
}

const BLOCO = codigoDoBloco();

/** Monta o bloco num ambiente de mentira e devolve as funções para testar. */
function montar(env: Ambiente) {
  const chamadas: Array<{ silencioso: unknown }> = [];
  const carimbos: string[] = [];
  const S = { route: env.rota };

  const janelas = env.janelaAberta
    ? [{ minimized: !!env.janelaMinimizada }]
    : [];

  const elementoCarimbo = { set innerHTML(v: string) { carimbos.push(v); } };

  const doc = {
    hidden: !!env.escondida,
    activeElement: env.focoEm ? { tagName: env.focoEm } : null,
    querySelectorAll: () => [elementoCarimbo],
    addEventListener: () => undefined,
  };
  const win = {
    __wins: janelas,
    __opDragId: env.arrastando ? 1 : null,
    getSelection: () => env.selecao ?? '',
    addEventListener: () => undefined,
    scrollY: 0,
    scrollTo: () => undefined,
  };

  const fabrica = new Function(
    'S', 'document', 'window', 'loadRoute', 'setInterval', 'clearInterval',
    `${BLOCO}
     return { autoRefreshPode, autoRefreshBotao, autoRefreshIniciar, autoRefreshCiclo, ROTAS_AO_VIVO };`,
  );

  return {
    ...fabrica(
      S, doc, win,
      async (silencioso: unknown) => { chamadas.push({ silencioso }); },
      () => 1,
      () => undefined,
    ),
    chamadas,
    carimbos,
    S,
  };
}

describe('auto-refresh das telas operacionais', () => {
  describe('quando PODE atualizar', () => {
    it('atualiza a Produção com a tela parada e ninguém mexendo', () => {
      expect(montar({ rota: 'producao' }).autoRefreshPode()).toBe(true);
    });

    it('atualiza com uma janela MINIMIZADA — minimizada não atrapalha ninguém', () => {
      const a = montar({ rota: 'producao', janelaAberta: true, janelaMinimizada: true });
      expect(a.autoRefreshPode()).toBe(true);
    });

    it('atualiza com o foco num botão (só campo de digitação trava)', () => {
      expect(montar({ rota: 'producao', focoEm: 'BUTTON' }).autoRefreshPode()).toBe(true);
    });
  });

  describe('quando NÃO pode — cada trava protege um jeito de atropelar o usuário', () => {
    it('não atualiza fora das telas operacionais', () => {
      // O financeiro e os cadastros não têm corrida entre usuários; recarregar
      // ali seria só gasto de banco.
      expect(montar({ rota: 'receber' }).autoRefreshPode()).toBe(false);
      expect(montar({ rota: 'clientes' }).autoRefreshPode()).toBe(false);
    });

    it('não atualiza com a aba em segundo plano', () => {
      expect(montar({ rota: 'producao', escondida: true }).autoRefreshPode()).toBe(false);
    });

    it('não atualiza com uma janela ABERTA na frente', () => {
      expect(montar({ rota: 'producao', janelaAberta: true }).autoRefreshPode()).toBe(false);
    });

    it('não atualiza enquanto uma OP está sendo ARRASTADA no kanban', () => {
      expect(montar({ rota: 'producao', arrastando: true }).autoRefreshPode()).toBe(false);
    });

    it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
      'não atualiza com o cursor dentro de um %s — apagaria o que está sendo digitado',
      (tag) => {
        expect(montar({ rota: 'producao', focoEm: tag }).autoRefreshPode()).toBe(false);
      },
    );

    it('não atualiza com texto SELECIONADO — some com a seleção na cara do usuário', () => {
      expect(montar({ rota: 'producao', selecao: 'OP-0042' }).autoRefreshPode()).toBe(false);
    });
  });

  describe('o ciclo', () => {
    it('recarrega em modo SILENCIOSO — a tela não pode piscar o spinner a cada ciclo', async () => {
      const a = montar({ rota: 'producao' });
      await a.autoRefreshCiclo();
      expect(a.chamadas).toEqual([{ silencioso: true }]);
    });

    it('travado, não chama o servidor nenhuma vez', async () => {
      const a = montar({ rota: 'producao', janelaAberta: true });
      await a.autoRefreshCiclo();
      expect(a.chamadas).toHaveLength(0);
    });
  });

  describe('o carimbo de hora', () => {
    it('mostra a hora quando a atualização deu certo', () => {
      const a = montar({ rota: 'producao' });
      a.autoRefreshIniciar(true);
      expect(a.carimbos.join('')).toMatch(/atualizado às \d{2}:\d{2}/);
    });

    it('avisa em vermelho quando a atualização FALHOU — o pior seria não avisar', () => {
      const a = montar({ rota: 'producao' });
      a.autoRefreshIniciar(false);
      const txt = a.carimbos.join('');
      expect(txt).toContain('sem atualizar desde');
      expect(txt).toContain('#c14a34');
    });
  });

  describe('o botão na barra', () => {
    it('aparece nas telas operacionais, com carimbo e ↻', () => {
      const html = montar({ rota: 'producao' }).autoRefreshBotao();
      expect(html).toContain('auto-carimbo');
      expect(html).toContain('APP.autoRefreshAgora()');
    });

    it('não aparece nas demais telas', () => {
      expect(montar({ rota: 'clientes' }).autoRefreshBotao()).toBe('');
    });
  });

  it('a Produção é a tela que atualiza mais rápido — foi onde o problema apareceu', () => {
    const { ROTAS_AO_VIVO } = montar({ rota: 'producao' });
    const intervalos = Object.values(ROTAS_AO_VIVO) as number[];
    expect(ROTAS_AO_VIVO.producao).toBe(Math.min(...intervalos));
    expect(ROTAS_AO_VIVO.producao).toBeLessThanOrEqual(30000);
  });
});
