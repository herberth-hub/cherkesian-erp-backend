/**
 * A chave anti-duplicata.
 *
 * Esta suíte existe por causa do Bradesco: a API de Saldo e Extrato não devolve
 * identificador de lançamento (o `numeroDocumento` repete), então a chave sai
 * do conteúdo. O que precisa ser verdade:
 *
 *   1. puxar a MESMA janela de novo não muda nenhuma chave (senão duplica);
 *   2. dois lançamentos realmente iguais no mesmo dia continuam dois;
 *   3. lançamentos diferentes nunca colidem.
 */
import { chaveEstavel, chavearLancamentos, textoDaChave, MAX_FITID } from './chave-lancamento';

const L = (valor: number, descricao: string, data = '2026-11-03', tipo: 'credito' | 'debito' = 'debito', documento: string | null = null) =>
  ({ data: new Date(data + 'T12:00:00Z'), valor, tipo, descricao, documento });

describe('chave estável de lançamento', () => {
  it('mesmo lançamento gera a mesma chave em puxadas diferentes', () => {
    expect(chaveEstavel(L(1250, 'TARIFA PACOTE DE SERVICOS'))).toBe(chaveEstavel(L(1250, 'TARIFA PACOTE DE SERVICOS')));
  });

  it('IGNORA variação de espaço, caixa e acento no histórico', () => {
    const a = chaveEstavel(L(1250, 'TED   RECEBIDA'));
    expect(chaveEstavel(L(1250, 'TED RECEBIDA'))).toBe(a);
    expect(chaveEstavel(L(1250, 'ted recebida'))).toBe(a);
    expect(chaveEstavel(L(1250, ' TRANSFERÊNCIA '))).toBe(chaveEstavel(L(1250, 'TRANSFERENCIA')));
  });

  it('separa o que é de fato diferente: valor, data, tipo, histórico e documento', () => {
    const base = chaveEstavel(L(1250, 'TARIFA'));
    expect(chaveEstavel(L(1250.01, 'TARIFA'))).not.toBe(base);
    expect(chaveEstavel(L(1250, 'TARIFA', '2026-11-04'))).not.toBe(base);
    expect(chaveEstavel(L(1250, 'TARIFA', '2026-11-03', 'credito'))).not.toBe(base);
    expect(chaveEstavel(L(1250, 'TARIFA DE TED'))).not.toBe(base);
    expect(chaveEstavel(L(1250, 'TARIFA', '2026-11-03', 'debito', '000123'))).not.toBe(base);
  });

  it('o sinal do valor não entra na chave — quem diz crédito/débito é o tipo', () => {
    expect(chaveEstavel(L(-1250, 'TARIFA'))).toBe(chaveEstavel(L(1250, 'TARIFA')));
  });

  it('lançamento único não leva sufixo', () => {
    expect(chaveEstavel(L(1250, 'TARIFA'))).not.toMatch(/-\d+$/);
  });

  it('cabe na coluna', () => {
    expect(chaveEstavel(L(1250, 'X'.repeat(4000)), 9).length).toBeLessThanOrEqual(MAX_FITID);
  });
});

describe('chavear a janela inteira', () => {
  it('usa o identificador do banco quando existe', () => {
    const r = chavearLancamentos([L(100, 'A'), L(200, 'B')], (_l) => 'ID-' + _l.descricao);
    expect(r.map((x) => x.fitid)).toEqual(['ID-A', 'ID-B']);
  });

  it('monta a chave do conteúdo quando o banco não dá identificador', () => {
    const r = chavearLancamentos([L(100, 'A')], () => null);
    expect(r[0].fitid).toMatch(/^SEM-ID-[0-9a-f]{24}$/);
  });

  /**
   * Duas tarifas iguais no mesmo dia acontecem de verdade. Se as duas caíssem
   * na mesma chave, uma delas desapareceria do espelho e o saldo não fecharia.
   */
  it('dois lançamentos idênticos no mesmo dia continuam DOIS', () => {
    const r = chavearLancamentos([L(55, 'TARIFA TED'), L(55, 'TARIFA TED')], () => null);
    expect(r[0].fitid).not.toBe(r[1].fitid);
    expect(r[1].fitid).toMatch(/-2$/);
  });

  /** O ponto todo: a segunda puxada tem de reproduzir as MESMAS chaves. */
  it('REPUXAR a mesma janela reproduz as mesmas chaves, na mesma ordem', () => {
    const janela = [L(55, 'TARIFA TED'), L(1200, 'PIX RECEBIDO', '2026-11-03', 'credito'), L(55, 'TARIFA TED')];
    const a = chavearLancamentos(janela, () => null).map((x) => x.fitid);
    const b = chavearLancamentos(janela, () => null).map((x) => x.fitid);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(3);
  });

  it('a numeração do repetido é por conteúdo, não por posição na lista', () => {
    // O PIX no meio não pode fazer a segunda tarifa virar "-3".
    const r = chavearLancamentos(
      [L(55, 'TARIFA TED'), L(1200, 'PIX', '2026-11-03', 'credito'), L(55, 'TARIFA TED')],
      () => null,
    );
    expect(r[2].fitid).toMatch(/-2$/);
  });

  it('identificador repetido do banco não some: o segundo ganha sufixo', () => {
    const r = chavearLancamentos([L(10, 'A'), L(20, 'B')], () => 'MESMO');
    expect(r[0].fitid).toBe('MESMO');
    expect(r[1].fitid).toBe('MESMO#2');
  });

  it('identificador gigante do banco é cortado para caber na coluna', () => {
    const r = chavearLancamentos([L(10, 'A')], () => 'Z'.repeat(500));
    expect(r[0].fitid.length).toBe(MAX_FITID);
  });

  it('não mexe nos outros campos do lançamento', () => {
    const r = chavearLancamentos([L(100, 'A')], () => 'ID');
    expect(r[0].valor).toBe(100);
    expect(r[0].descricao).toBe('A');
  });
});

describe('texto da chave', () => {
  it('aguenta nulo e vazio sem explodir', () => {
    expect(textoDaChave(null)).toBe('');
    expect(textoDaChave(undefined)).toBe('');
    expect(textoDaChave('   ')).toBe('');
  });
});
