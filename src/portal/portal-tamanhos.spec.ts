import { PortalService } from './portal.service';

describe('PortalService — tamanhos e saldo pronta-entrega', () => {
  describe('tamanhosDaGrade', () => {
    it('lê a grade em lista', () => {
      expect(PortalService.tamanhosDaGrade('PP, P, M, G, GG')).toEqual(['PP', 'P', 'M', 'G', 'GG']);
    });

    it('expande faixa "P ao GG" na escala da casa', () => {
      expect(PortalService.tamanhosDaGrade('P ao GG')).toEqual(['P', 'M', 'G', 'GG']);
    });

    it('mantém o GG entre o G e o G1 (escala do cadastro de produto)', () => {
      expect(PortalService.tamanhosDaGrade('G ao G2')).toEqual(['G', 'GG', 'G1', 'G2']);
    });

    it('devolve vazio quando não há grade', () => {
      expect(PortalService.tamanhosDaGrade(null)).toEqual([]);
      expect(PortalService.tamanhosDaGrade('')).toEqual([]);
    });
  });

  describe('tamanhosDoProduto', () => {
    it('sem saldo, ainda oferece todos os tamanhos da grade (sob encomenda)', () => {
      const r = PortalService.tamanhosDoProduto(undefined, 'P, M, G');
      expect(r).toEqual([
        { tamanho: 'P', saldo: 0 },
        { tamanho: 'M', saldo: 0 },
        { tamanho: 'G', saldo: 0 },
      ]);
    });

    it('cruza o saldo pronta-entrega (contado por etiqueta) com a grade', () => {
      const saldos = new Map([['M', 256], ['G', 4]]);
      const r = PortalService.tamanhosDoProduto(saldos, 'P, M, G');
      expect(r).toEqual([
        { tamanho: 'P', saldo: 0 },
        { tamanho: 'M', saldo: 256 },
        { tamanho: 'G', saldo: 4 },
      ]);
    });

    it('inclui tamanho que existe em estoque mesmo fora da grade', () => {
      const r = PortalService.tamanhosDoProduto(new Map([['G3', 2]]), 'P, M');
      expect(r.map((t) => t.tamanho)).toEqual(['P', 'M', 'G3']);
      expect(r.find((t) => t.tamanho === 'G3')?.saldo).toBe(2);
    });

    it('ignora o tamanho vazio que a etiqueta grava como "—"', () => {
      const r = PortalService.tamanhosDoProduto(new Map([['—', 9], ['M', 3]]), 'M');
      expect(r).toEqual([{ tamanho: 'M', saldo: 3 }]);
    });

    it('ordena na escala da casa, não em ordem alfabética', () => {
      const r = PortalService.tamanhosDoProduto(new Map(), 'PP, P, M, G, GG, G1, G2, G10');
      expect(r.map((t) => t.tamanho)).toEqual(['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G10']);
    });
  });
});
