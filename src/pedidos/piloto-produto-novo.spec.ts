/**
 * PEÇA-PILOTO: QUEM EXIGE É O PRODUTO, NÃO O CLIENTE.
 *
 * A piloto aprova o que a casa nunca fez — modelagem, caimento, bordado. Pedir
 * amostra a um cliente novo que comprou um jaleco produzido há dois anos só
 * atrasa a entrega dele. Foi o que aconteceu com o PV227 (INTS HDSA): os três
 * produtos já tinham sido produzidos no PV28 e mesmo assim o pedido parou em
 * "piloto", porque a conta estava marcada como cliente novo.
 */
import { etapaAoAprovar, motivoPiloto, produtosQueExigemPiloto } from './produto-novo';

const item = (produtoId: number | null, descricao: string, quantidade = 10) => ({ produtoId, descricao, quantidade });

const JALECO = item(127, 'JALECO MÉDICO M.L');
const POLO = item(128, 'CAMISETA POLO M.C');
const COLETE = item(126, 'COLETE - POSSO AJUDAR');

describe('o que exige piloto', () => {
  it('produto que nunca foi produzido exige', () => {
    const novos = produtosQueExigemPiloto([JALECO], new Set());
    expect(novos).toEqual([{ produtoId: 127, descricao: 'JALECO MÉDICO M.L' }]);
    expect(etapaAoAprovar(novos)).toBe('piloto');
  });

  it('o caso do PV227: todos os produtos já produzidos, nada de piloto', () => {
    const novos = produtosQueExigemPiloto([JALECO, POLO, COLETE], new Set([126, 127, 128]));
    expect(novos).toEqual([]);
    expect(etapaAoAprovar(novos)).toBe('aprovado');
  });

  it('um único produto novo no meio de conhecidos já segura o pedido', () => {
    const novos = produtosQueExigemPiloto([JALECO, POLO, item(999, 'AVENTAL NOVO')], new Set([127, 128]));
    expect(novos.map((p) => p.produtoId)).toEqual([999]);
  });

  it('o mesmo produto repetido em duas linhas não vira duas pendências', () => {
    // Grade em duas faixas de preço = duas linhas do MESMO produto.
    const novos = produtosQueExigemPiloto([JALECO, item(127, 'JALECO MÉDICO M.L', 20)], new Set());
    expect(novos).toHaveLength(1);
  });

  it('linha zerada (sobra de retificação) não exige piloto de nada', () => {
    expect(produtosQueExigemPiloto([item(555, 'PEÇA REMOVIDA', 0)], new Set())).toEqual([]);
  });

  it('item em texto livre não cai aqui — a trava dele é outra, na geração da OP', () => {
    expect(produtosQueExigemPiloto([item(null, 'UNIFORME SOB MEDIDA')], new Set())).toEqual([]);
  });

  it('pedido sem item nenhum não inventa pendência', () => {
    expect(etapaAoAprovar(produtosQueExigemPiloto([], new Set()))).toBe('aprovado');
  });
});

describe('o aviso diz de QUAL peça se trata', () => {
  it('um produto: nomeia a peça', () => {
    const m = motivoPiloto(produtosQueExigemPiloto([JALECO], new Set()));
    expect(m).toContain('"JALECO MÉDICO M.L"');
    expect(m).toContain('nunca foi produzido');
  });

  it('vários: conta quantos e lista todos', () => {
    const m = motivoPiloto(produtosQueExigemPiloto([JALECO, POLO], new Set()));
    expect(m).toContain('2 produtos');
    expect(m).toContain('"JALECO MÉDICO M.L"');
    expect(m).toContain('"CAMISETA POLO M.C"');
  });

  it('sem produto novo não há recado a dar', () => {
    expect(motivoPiloto([])).toBe('');
  });

  it('o aviso não fala em cliente novo — a regra deixou de ser essa', () => {
    const m = motivoPiloto(produtosQueExigemPiloto([JALECO], new Set()));
    expect(m).not.toMatch(/cliente/i);
  });
});
