/**
 * A FAIXA DO CABEÇALHO DA TABELA.
 *
 * "SEM ENDEREÇO" numa coluna de 60pt não cabe numa linha. Enquanto a faixa
 * dourada tinha altura fixa de 20pt, a segunda linha do título descia POR CIMA
 * da primeira linha de dados — e o relatório de estoque, que é o que tem mais
 * colunas, era o que ficava ilegível.
 */
import { novoDocumento, tabela } from './pdf.renderer';

/** Desenha e devolve onde o corpo da tabela começou (doc.y depois do cabeçalho). */
function alturaDoCabecalho(colunas: Array<{ titulo: string; largura: number }>): number {
  const doc = novoDocumento('Teste', 'T-1');
  const yAntes = doc.y;
  tabela(doc, colunas, []); // sem linhas: o que sobra é o cabeçalho
  return doc.y - yAntes;
}

const LARGAS = [{ titulo: 'Código', largura: 200 }, { titulo: 'Descrição', largura: 295 }];
const ESTREITAS = [
  { titulo: 'Código', largura: 60 },
  { titulo: 'Descrição', largura: 120 },
  { titulo: 'Sem endereço', largura: 55 },
  { titulo: 'Quarentena', largura: 55 },
  { titulo: 'Pronta-entrega', largura: 55 },
  { titulo: 'Etiquetas', largura: 50 },
];

describe('o cabeçalho cresce com o título', () => {
  it('título curto em coluna larga: faixa no tamanho de sempre', () => {
    // 20pt de faixa + 12pt de respiro acima/abaixo que a tabela já reservava.
    const h = alturaDoCabecalho(LARGAS);
    expect(h).toBeGreaterThanOrEqual(32);
    expect(h).toBeLessThan(34);
  });

  it('título que precisa de duas linhas empurra o corpo da tabela para baixo', () => {
    expect(alturaDoCabecalho(ESTREITAS)).toBeGreaterThan(alturaDoCabecalho(LARGAS));
  });

  it('a faixa acomoda as duas linhas inteiras — não corta nem invade a primeira linha', () => {
    // Duas linhas de 8pt pedem ~19pt de texto; com o respiro de 11, ~30.
    const h = alturaDoCabecalho(ESTREITAS);
    expect(h).toBeGreaterThanOrEqual(40); // 32 de antes + a segunda linha
    expect(h).toBeLessThan(56);           // e não estoura numa faixa gigante
  });
});
