import { PortalService } from './portal.service';

/** Monta o mapa que o saldoPronta devolve: produto -> cor normalizada -> tamanho -> qtd. */
const saldo = (porCor: Record<string, Record<string, number>>) =>
  new Map(Object.entries(porCor).map(([c, tams]) => [c, new Map(Object.entries(tams))]));

describe('PortalService — cores', () => {
  describe('coresDoProduto', () => {
    it('separa por vírgula, como o resto do sistema', () => {
      expect(PortalService.coresDoProduto('AZUL ROYAL, BRANCO')).toEqual(['AZUL ROYAL', 'BRANCO']);
    });

    it('aceita ponto e vírgula e descarta vazios', () => {
      expect(PortalService.coresDoProduto('PRETO; CINZA;;')).toEqual(['PRETO', 'CINZA']);
    });

    it('cor única continua sendo uma cor só', () => {
      expect(PortalService.coresDoProduto('AZUL CLARO')).toEqual(['AZUL CLARO']);
    });

    it('produto sem cor não inventa cor', () => {
      expect(PortalService.coresDoProduto(null)).toEqual([]);
      expect(PortalService.coresDoProduto('  ')).toEqual([]);
    });
  });

  describe('saldoDaCor', () => {
    const porCor = saldo({ 'AZUL ROYAL': { M: 256 }, BRANCO: { P: 4 } });

    it('com várias cores, devolve só o saldo daquela cor', () => {
      expect([...PortalService.saldoDaCor(porCor, 'AZUL ROYAL', 2)]).toEqual([['M', 256]]);
      expect([...PortalService.saldoDaCor(porCor, 'BRANCO', 2)]).toEqual([['P', 4]]);
    });

    it('não empresta o saldo de uma cor para a outra', () => {
      const so = saldo({ 'AZUL ROYAL': { M: 256 } });
      expect([...PortalService.saldoDaCor(so, 'BRANCO', 2)]).toEqual([]);
    });

    it('ignora diferença de caixa entre etiqueta e cadastro', () => {
      const s = saldo({ CINZA: { G: 7 } });
      expect([...PortalService.saldoDaCor(s, 'Cinza', 3)]).toEqual([['G', 7]]);
    });

    it('com cor única, soma tudo — a etiqueta pode estar grafada diferente', () => {
      const s = saldo({ 'AZUL MARINHO': { M: 3 }, '': { M: 2, G: 1 } });
      const r = PortalService.saldoDaCor(s, 'Azul Marinho', 1);
      expect(r.get('M')).toBe(5);
      expect(r.get('G')).toBe(1);
    });

    it('peça sem cor na etiqueta não vira cor nenhuma num produto multi-cor', () => {
      const s = saldo({ '': { M: 9 } });
      expect([...PortalService.saldoDaCor(s, 'AZUL ROYAL', 2)]).toEqual([]);
    });
  });

  describe('o caso real do INTS BICAS', () => {
    // PRD-CAL-0009: cadastrado em AZUL ROYAL e BRANCO; as 256 peças prontas são todas azuis.
    const porCor = saldo({ 'AZUL ROYAL': { M: 256 } });
    const grade = 'PP, P, M, G, GG, G1, G2, G3, G4, G5, G6, G7, G8';

    it('o azul mostra as 256 no M', () => {
      const t = PortalService.tamanhosDoProduto(PortalService.saldoDaCor(porCor, 'AZUL ROYAL', 2), grade);
      expect(t.find((x) => x.tamanho === 'M')?.saldo).toBe(256);
      expect(t.reduce((s, x) => s + x.saldo, 0)).toBe(256);
    });

    it('o branco não promete pronta entrega nenhuma', () => {
      const t = PortalService.tamanhosDoProduto(PortalService.saldoDaCor(porCor, 'BRANCO', 2), grade);
      expect(t.reduce((s, x) => s + x.saldo, 0)).toBe(0);
      // mas continua pedível: a grade inteira aparece, para produção
      expect(t).toHaveLength(13);
    });
  });
});
