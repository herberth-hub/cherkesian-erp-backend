/**
 * A conciliação decide se o sistema baixa um título sozinho. Baixa errada é
 * pior que baixa não feita: título quitado por engano some da cobrança e
 * ninguém vai atrás de dinheiro que o sistema diz que já entrou.
 *
 * Por isso o teste mais importante deste arquivo não é o que o motor acerta —
 * é o que ele se RECUSA a decidir sozinho.
 */
import { sugerir, decidirAuto, pontuar, norm, palavrasFortes } from './conciliacao.util';

const d = (s: string) => new Date(s + 'T12:00:00');

const REC = (id: number, valor: number, venc: string, extra: Record<string, unknown> = {}) => ({
  id, tipo: 'receber' as const, valor, saldo: valor, vencimento: d(venc),
  documento: null, parte: null, pedidoNumero: null, ...extra,
});
const PAG = (id: number, valor: number, venc: string, extra: Record<string, unknown> = {}) => ({
  ...REC(id, valor, venc, extra), tipo: 'pagar' as const,
});

const CRED = (valor: number, data: string, descricao = '') => ({ valor, data: d(data), tipo: 'credito' as const, descricao });
const DEB = (valor: number, data: string, descricao = '') => ({ valor, data: d(data), tipo: 'debito' as const, descricao });

describe('lado do lançamento', () => {
  it('crédito só olha contas a RECEBER', () => {
    const s = sugerir(CRED(100, '2026-10-05'), [REC(1, 100, '2026-10-05'), PAG(2, 100, '2026-10-05')]);
    expect(s.map((x) => x.tituloId)).toEqual([1]);
  });

  it('débito só olha contas a PAGAR', () => {
    const s = sugerir(DEB(100, '2026-10-05'), [REC(1, 100, '2026-10-05'), PAG(2, 100, '2026-10-05')]);
    expect(s.map((x) => x.tituloId)).toEqual([2]);
  });

  it('título já quitado (saldo zero) não entra', () => {
    const s = sugerir(CRED(100, '2026-10-05'), [REC(1, 100, '2026-10-05', { saldo: 0 })]);
    expect(s).toHaveLength(0);
  });
});

describe('o que pontua', () => {
  it('valor exato no saldo vale mais que valor exato no total', () => {
    const exato = pontuar(CRED(500, '2026-10-05'), REC(1, 500, '2026-10-05'));
    const parcial = pontuar(CRED(500, '2026-10-05'), REC(2, 800, '2026-10-05', { saldo: 300 }));
    expect(exato.score).toBeGreaterThan(parcial.score);
  });

  it('nome do cliente na descrição do banco pontua', () => {
    const com = pontuar(CRED(500, '2026-10-05', 'TED RECEBIDA SANEPAV INDUSTRIAL'), REC(1, 500, '2026-10-05', { parte: 'SANEPAV LTDA' }));
    const sem = pontuar(CRED(500, '2026-10-05', 'TED RECEBIDA'), REC(1, 500, '2026-10-05', { parte: 'SANEPAV LTDA' }));
    expect(com.score).toBeGreaterThan(sem.score);
    expect(com.motivos.join(' ')).toMatch(/SANEPAV/);
  });

  it('número do pedido na descrição pontua', () => {
    const s = pontuar(CRED(500, '2026-10-05', 'PIX REF PV147'), REC(1, 500, '2026-10-05', { pedidoNumero: 'PV147' }));
    expect(s.motivos.join(' ')).toMatch(/PV147/);
  });

  it('valor MAIOR que o saldo perde ponto (não é esse título)', () => {
    const s = pontuar(CRED(900, '2026-10-05'), REC(1, 500, '2026-10-05'));
    expect(s.motivos.join(' ')).toMatch(/maior que o saldo/);
    expect(s.score).toBeLessThan(40);
  });

  it('cada ponto vem com um motivo em português', () => {
    const s = pontuar(CRED(500, '2026-10-05', 'TED SANEPAV'), REC(1, 500, '2026-10-05', { parte: 'SANEPAV' }));
    expect(s.motivos.length).toBeGreaterThanOrEqual(3);
    expect(s.motivos.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
  });

  it('ordena do mais provável para o menos', () => {
    const s = sugerir(CRED(500, '2026-10-05', 'TED SANEPAV'), [
      REC(1, 500, '2026-12-20'),
      REC(2, 500, '2026-10-05', { parte: 'SANEPAV' }),
    ]);
    expect(s[0].tituloId).toBe(2);
  });
});

describe('o sistema baixa sozinho?', () => {
  const auto = (l: ReturnType<typeof CRED>, c: ReturnType<typeof REC>[]) => decidirAuto(l, sugerir(l, c), c);

  it('SIM: valor exato, na data, candidato único', () => {
    const c = [REC(1, 1392, '2026-10-05', { parte: 'SANEPAV' })];
    expect(auto(CRED(1392, '2026-10-05', 'TED RECEBIDA SANEPAV'), c)?.tituloId).toBe(1);
  });

  it('NÃO: dois títulos do mesmo valor no mesmo dia — empate não se decide sozinho', () => {
    const c = [REC(1, 1392, '2026-10-05'), REC(2, 1392, '2026-10-05')];
    expect(auto(CRED(1392, '2026-10-05', 'TED RECEBIDA'), c)).toBeNull();
  });

  it('NÃO: valor diferente do saldo, por mais que o resto combine', () => {
    const c = [REC(1, 1500, '2026-10-05', { parte: 'SANEPAV', pedidoNumero: 'PV147' })];
    expect(auto(CRED(1392, '2026-10-05', 'TED SANEPAV PV147'), c)).toBeNull();
  });

  it('NÃO: nenhum candidato', () => {
    expect(auto(CRED(1392, '2026-10-05', 'TARIFA'), [])).toBeNull();
  });

  it('NÃO: valor bate mas a data está longe e nada mais combina', () => {
    const c = [REC(1, 1392, '2026-01-10')];
    expect(auto(CRED(1392, '2026-10-05', 'CREDITO'), c)).toBeNull();
  });

  it('SIM: o segundo candidato é fraco o bastante para não haver dúvida', () => {
    const c = [
      REC(1, 1392, '2026-10-05', { parte: 'SANEPAV', pedidoNumero: 'PV147' }),
      REC(2, 1392, '2026-02-01'),
    ];
    const r = auto(CRED(1392, '2026-10-05', 'TED SANEPAV REF PV147'), c);
    expect(r?.tituloId).toBe(1);
  });

  it('empate por centavos também não passa', () => {
    const c = [REC(1, 1392, '2026-10-05', { parte: 'SANEPAV' }), REC(2, 1392.01, '2026-10-05', { parte: 'SANEPAV' })];
    expect(auto(CRED(1392, '2026-10-05', 'TED SANEPAV'), c)).toBeNull();
  });
});

describe('normalização de texto', () => {
  it('tira acento e caixa', () => expect(norm('Comércio Têxtil')).toBe('COMERCIO TEXTIL'));
  it('ignora palavras que não identificam ninguém', () =>
    expect(palavrasFortes('SANEPAV INDUSTRIA E COMERCIO LTDA')).toEqual(['SANEPAV']));
});
