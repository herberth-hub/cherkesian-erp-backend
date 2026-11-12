/**
 * O EXTRATO DO CORA, TRADUZIDO.
 *
 * Aqui mora o tipo de erro que custa dinheiro e não aparece: ler centavos como
 * reais multiplica o extrato inteiro por cem; deixar um BLOCK entrar cria um
 * crédito fantasma para alguém conciliar; perder o nome de quem pagou faz o
 * casamento automático parar de funcionar e a conciliação voltar a ser manual.
 */
import { traduzirExtratoCora, descricaoCora, diaIso, soDigitos, CoraExtratoResposta } from './cora.traducao';
import { centavosParaReais } from './extrato-fonte';

const entrada = (over: Record<string, unknown> = {}) => ({
  id: 'ent_001',
  type: 'CREDIT',
  amount: 139200, // R$ 1.392,00
  createdAt: '2026-10-05T14:22:10.000Z',
  transaction: {
    id: 'tx_1',
    type: 'PIX',
    description: 'Pagamento NF 2731',
    counterParty: { name: 'SANEPAV SANEAMENTO AMBIENTAL LTDA', identity: '12345678000199' },
  },
  ...over,
});

const resposta = (entries: unknown[], over: Partial<CoraExtratoResposta> = {}): CoraExtratoResposta => ({
  start: { date: '2026-10-01', balance: 1000000 },
  end: { date: '2026-10-31', balance: 2500075 },
  entries: entries as CoraExtratoResposta['entries'],
  ...over,
});

describe('dinheiro vem em centavos', () => {
  it('139200 centavos é R$ 1.392,00 — não R$ 139.200', () => {
    const { lancamentos } = traduzirExtratoCora(resposta([entrada()]));
    expect(lancamentos[0].valor).toBe(1392);
  });

  it('o saldo do fim da janela também é convertido', () => {
    expect(traduzirExtratoCora(resposta([entrada()])).saldo).toBe(25000.75);
  });

  it('centavo quebrado não vira dízima', () => {
    expect(centavosParaReais(1)).toBe(0.01);
    expect(centavosParaReais(99)).toBe(0.99);
    expect(centavosParaReais(2500075)).toBe(25000.75);
  });
});

describe('o que NÃO é movimento de dinheiro fica de fora', () => {
  it('BLOCK e UNBLOCK não entram como lançamento', () => {
    const { lancamentos } = traduzirExtratoCora(resposta([
      entrada(), entrada({ id: 'b1', type: 'BLOCK' }), entrada({ id: 'u1', type: 'UNBLOCK' }),
    ]));
    expect(lancamentos).toHaveLength(1);
    expect(lancamentos[0].fitid).toBe('ent_001');
  });

  it('lançamento sem id do banco é descartado — sem ele não há trava anti-duplicata', () => {
    expect(traduzirExtratoCora(resposta([entrada({ id: '' })])).lancamentos).toEqual([]);
  });

  it('valor zero não é dinheiro', () => {
    expect(traduzirExtratoCora(resposta([entrada({ amount: 0 })])).lancamentos).toEqual([]);
  });

  it('data inválida não vira Invalid Date dentro do extrato', () => {
    expect(traduzirExtratoCora(resposta([entrada({ createdAt: 'ontem' })])).lancamentos).toEqual([]);
  });

  it('resposta vazia não quebra', () => {
    expect(traduzirExtratoCora({}).lancamentos).toEqual([]);
    expect(traduzirExtratoCora(resposta([])).lancamentos).toEqual([]);
  });
});

describe('crédito e débito', () => {
  it('CREDIT vira credito e DEBIT vira debito, sempre com valor positivo', () => {
    const { lancamentos } = traduzirExtratoCora(resposta([
      entrada(), entrada({ id: 'ent_002', type: 'DEBIT', amount: 50000 }),
    ]));
    expect(lancamentos.map((l) => [l.tipo, l.valor])).toEqual([['credito', 1392], ['debito', 500]]);
  });
});

describe('quem pagou — o sinal que o motor de conciliação usa', () => {
  it('a descrição junta tipo, histórico e nome da contraparte', () => {
    expect(descricaoCora(entrada())).toBe('PIX · Pagamento NF 2731 · SANEPAV SANEAMENTO AMBIENTAL LTDA');
  });

  it('não repete quando o banco manda a mesma coisa em dois campos', () => {
    const e = entrada({ transaction: { type: 'PIX', description: 'PIX', counterParty: { name: 'pix' } } });
    expect(descricaoCora(e)).toBe('PIX');
  });

  it('sem nenhum texto, diz isso em vez de ficar em branco', () => {
    expect(descricaoCora(entrada({ transaction: null }))).toBe('Lançamento sem descrição');
  });

  it('o CNPJ da contraparte vai no documento — ajuda quando o nome vem abreviado', () => {
    expect(traduzirExtratoCora(resposta([entrada()])).lancamentos[0].documento).toBe('12345678000199');
  });

  it('o número da nota sobrevive na descrição — é por ele que o título casa', () => {
    expect(traduzirExtratoCora(resposta([entrada()])).lancamentos[0].descricao).toContain('2731');
  });
});

/**
 * DE QUEM É A CONTA.
 *
 * Uma credencial de API abre UMA conta, e a tela oferece todas as do banco.
 * Esta é a mesma conferência que o OFX já fazia pelo número da conta — sem
 * ela, puxar com a conta errada selecionada arquiva o dinheiro de um CNPJ
 * debaixo de outro e o erro só aparece no fechamento.
 */
describe('o titular da conta', () => {
  it('o CNPJ do titular sai do header, só com os dígitos', () => {
    const t = traduzirExtratoCora(resposta([entrada()], {
      header: { businessName: 'HC QUALITY CORPORATE', businessDocument: '45.704.956/0002-93' },
    }));
    expect(t.titularDocumento).toBe('45704956000293');
    expect(t.titularNome).toBe('HC QUALITY CORPORATE');
  });

  it('sem header, não inventa titular — a trava simplesmente não dispara', () => {
    const t = traduzirExtratoCora(resposta([entrada()]));
    expect(t.titularDocumento).toBeNull();
  });

  it('CNPJ com e sem máscara são o mesmo número', () => {
    expect(soDigitos('45.704.956/0002-93')).toBe(soDigitos('45704956000293'));
  });

  it('as duas contas do mesmo grupo NÃO se confundem — é a raiz igual que engana', () => {
    // Matriz Barueri e filial Muriaé têm a mesma raiz e são contas diferentes.
    expect(soDigitos('45704956000102')).not.toBe(soDigitos('45704956000293'));
  });
});

describe('a janela', () => {
  it('o saldo que vale é o do FIM do período', () => {
    const t = traduzirExtratoCora(resposta([entrada()]));
    expect(t.saldo).toBe(25000.75);
    expect(t.saldoEm?.toISOString().slice(0, 10)).toBe('2026-10-31');
  });

  it('data vira AAAA-MM-DD para a query, sem escorregar de dia', () => {
    expect(diaIso(new Date('2026-11-12T23:40:00Z'))).toBe('2026-11-12');
    expect(diaIso(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});
