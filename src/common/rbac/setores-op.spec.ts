/**
 * TRAVA DE MOVIMENTAÇÃO POR SETOR.
 *
 * A área (`@Areas`) diz em que TELA o usuário entra. No chão de fábrica isso
 * não basta: todo mundo da produção usa a MESMA tela, e qualquer um podia
 * empurrar qualquer OP de qualquer etapa — dar baixa em corte que ninguém
 * cortou, finalizar peça que não passou pela costura.
 *
 * Duas decisões que este teste prende, porque são as que mais doem se mudarem
 * sem querer:
 *
 * 1. DESLIGADO POR PADRÃO. Usuário sem setor marcado continua movimentando
 *    tudo. Se isso inverter, a fábrica inteira trava no dia do deploy.
 * 2. VALE PARA TODOS OS PERFIS, inclusive `total`. O líder de produção tem
 *    acesso total e é justamente ele que precisa ficar dentro do setor dele —
 *    uma trava que o admin pula não serve para nada aqui.
 */
import {
  FASE_SETOR,
  SETORES_OP,
  podeMoverFase,
  recadoDeBloqueio,
  setorDaFase,
  setoresValidos,
} from './setores-op';

describe('trava de movimentação por setor', () => {
  describe('desligada por padrão', () => {
    it.each([[undefined], [null], [[]]])('sem setor marcado (%p), move qualquer etapa', (setores) => {
      for (const fase of Object.keys(FASE_SETOR)) {
        expect(podeMoverFase(setores as string[] | null | undefined, fase)).toBe(true);
      }
    });

    it('lixo gravado no campo não liga a trava sem querer', () => {
      // Um valor inválido sozinho equivale a "nenhum setor": seria pior travar
      // a pessoa por causa de um dado sujo do que deixá-la trabalhar.
      expect(setoresValidos(['', '  ', 'xpto'])).toEqual([]);
      expect(podeMoverFase(['xpto'], 'Costura')).toBe(true);
    });
  });

  describe('ligada para quem tem setor', () => {
    it('a costura move o que está NA costura', () => {
      expect(podeMoverFase(['costura'], 'Costura')).toBe(true);
    });

    it('a costura NÃO move o que está no corte', () => {
      expect(podeMoverFase(['costura'], 'Corte')).toBe(false);
    });

    it('quem responde por mais de um setor move os dois', () => {
      expect(podeMoverFase(['corte', 'acabamento'], 'Corte')).toBe(true);
      expect(podeMoverFase(['corte', 'acabamento'], 'Acabamento')).toBe(true);
      expect(podeMoverFase(['corte', 'acabamento'], 'Costura')).toBe(false);
    });

    it('as DUAS separações são do mesmo setor — é a mesma equipe', () => {
      expect(podeMoverFase(['separacao'], 'Separação 1')).toBe(true);
      expect(podeMoverFase(['separacao'], 'Separação 2')).toBe(true);
    });

    it('"Finalizado" é do acabamento, que é quem etiqueta a peça pronta', () => {
      expect(setorDaFase('Finalizado')).toBe('acabamento');
      expect(podeMoverFase(['acabamento'], 'Finalizado')).toBe(true);
      expect(podeMoverFase(['costura'], 'Finalizado')).toBe(false);
    });

    it('OP que ainda não começou é do PCP — soltar para produção é planejamento', () => {
      for (const vazio of [null, undefined, '', '   ']) {
        expect(setorDaFase(vazio)).toBe('pcp');
      }
      expect(podeMoverFase(['pcp'], null)).toBe(true);
      expect(podeMoverFase(['costura'], null)).toBe(false);
    });

    it('ignora caixa e espaço no que está gravado', () => {
      expect(podeMoverFase([' COSTURA '], 'Costura')).toBe(true);
    });
  });

  describe('o recado que o usuário lê', () => {
    it('diz de quem é a etapa E do que ele responde — senão vira "acesso negado" seco', () => {
      const msg = recadoDeBloqueio(['costura'], 'Corte');
      expect(msg).toContain('Corte');
      expect(msg).toContain('Costura');
      expect(msg).toMatch(/peça ao/i);
    });
  });

  describe('o mapa de etapas', () => {
    it('toda etapa da OP tem dono, e o dono é um setor que existe', () => {
      // Se alguém acrescentar uma etapa nova e esquecer de dar dono, ela cai em
      // 'pcp' silenciosamente — e a costura perde o direito de movimentar algo
      // que é dela. Este teste obriga o mapa a acompanhar as fases.
      const fases = ['Risco CAD', 'Corte', 'Separação 1', 'Estamparia/Bordado', 'Separação 2', 'Costura', 'Acabamento', 'Finalizado'];
      for (const f of fases) {
        expect(Object.keys(FASE_SETOR)).toContain(f);
        expect(SETORES_OP).toContain(FASE_SETOR[f]);
      }
    });

    it('não sobra setor sem etapa, fora o PCP (que cuida do que ainda não começou)', () => {
      const usados = new Set(Object.values(FASE_SETOR));
      for (const s of SETORES_OP) {
        if (s === 'pcp') continue;
        expect(usados).toContain(s);
      }
    });
  });
});
