/**
 * O leitor de OFX é a porta de entrada do dinheiro do banco no sistema. Um erro
 * aqui não aparece como erro: aparece como saldo que não bate. Por isso os
 * testes cobrem os dois dialetos, a vírgula decimal do banco brasileiro e,
 * principalmente, a chave que impede o mesmo extrato de entrar duas vezes.
 */
import { lerOfx, numeroOfx, dataOfx } from './ofx.parser';

const OFX1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>033<BRANCHID>4338<ACCTID>130019372<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001
<DTEND>20261031
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261005120000[-3:BRT]
<TRNAMT>1392.00
<FITID>2026100500001
<MEMO>TED RECEBIDA SANEPAV IND
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261006120000[-3:BRT]
<TRNAMT>-230.50
<FITID>2026100600002
<CHECKNUM>884422
<MEMO>PAGTO FORNECEDOR MALHARIA
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>15320.75<DTASOF>20261031</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const OFX2 = `<?xml version="1.0" encoding="UTF-8"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>403</BANKID><ACCTID>99887766</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261029</DTPOSTED><TRNAMT>3300.00</TRNAMT>
<FITID>abc-123</FITID><NAME>PIX RECEBIDO</NAME><MEMO>VIVARA TELLERINA</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('leitor de OFX', () => {
  it('lê o dialeto 1.x (SGML, tag sem fechar)', () => {
    const e = lerOfx(OFX1);
    expect(e.banco).toBe('033');
    expect(e.agencia).toBe('4338');
    expect(e.conta).toBe('130019372');
    expect(e.saldo).toBe(15320.75);
    expect(e.lancamentos).toHaveLength(2);
  });

  it('separa crédito de débito pelo SINAL, e guarda o valor positivo', () => {
    const [cred, deb] = lerOfx(OFX1).lancamentos;
    expect(cred).toMatchObject({ tipo: 'credito', valor: 1392, documento: null });
    expect(deb).toMatchObject({ tipo: 'debito', valor: 230.5, documento: '884422' });
  });

  it('a data não anda um dia por causa do fuso do arquivo', () => {
    const [cred] = lerOfx(OFX1).lancamentos;
    expect(cred.data.getDate()).toBe(5);
    expect(cred.data.getMonth()).toBe(9); // outubro
  });

  it('lê o dialeto 2.x (XML) e junta NAME + MEMO na descrição', () => {
    const e = lerOfx(OFX2);
    expect(e.banco).toBe('403');
    expect(e.lancamentos[0].descricao).toBe('PIX RECEBIDO · VIVARA TELLERINA');
    expect(e.lancamentos[0].valor).toBe(3300);
  });

  it('ordena por data, mesmo se o arquivo vier fora de ordem', () => {
    const fora = OFX1.replace('20261005120000', '20261020120000');
    const d = lerOfx(fora).lancamentos.map((l) => l.data.getDate());
    expect(d).toEqual([6, 20]);
  });

  describe('chave anti-duplicata (é o que impede o mesmo extrato entrar 2x)', () => {
    it('usa o FITID do banco quando ele manda', () => {
      expect(lerOfx(OFX1).lancamentos[0].fitid).toBe('2026100500001');
    });

    it('sem FITID, monta a chave do conteúdo — a mesma linha dá a mesma chave', () => {
      const semId = OFX1.replace(/<FITID>[^\n]*\n/g, '');
      const a = lerOfx(semId).lancamentos[0].fitid;
      const b = lerOfx(semId).lancamentos[0].fitid;
      expect(a).toBe(b);
      expect(a).toContain('SEMFITID');
    });

    it('duas linhas IDÊNTICAS no mesmo arquivo não viram uma só', () => {
      const dobrado = OFX1.replace(
        '</BANKTRANLIST>',
        `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-18.90<FITID>TARIFA<MEMO>TARIFA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-18.90<FITID>TARIFA<MEMO>TARIFA</STMTTRN>
</BANKTRANLIST>`);
      const tarifas = lerOfx(dobrado).lancamentos.filter((l) => l.valor === 18.9);
      expect(tarifas).toHaveLength(2);
      expect(tarifas[0].fitid).not.toBe(tarifas[1].fitid);
    });
  });

  describe('recusa arquivo que não serve, em vez de ler errado', () => {
    it('arquivo vazio', () => expect(() => lerOfx('')).toThrow(/vazio/i));
    it('não é OFX', () => expect(() => lerOfx('data;valor\n01/10;100')).toThrow(/OFX/i));
    it('OFX sem lançamento nenhum', () =>
      expect(() => lerOfx('<OFX><BANKTRANLIST></BANKTRANLIST></OFX>')).toThrow(/Nenhum lançamento/i));
    it('lançamento truncado é descartado, não entra com valor errado', () => {
      const truncado = OFX1.replace('<TRNAMT>-230.50', '<TRNAMT>');
      expect(lerOfx(truncado).lancamentos).toHaveLength(1);
    });
  });
});

describe('número do OFX', () => {
  it('ponto decimal (padrão)', () => expect(numeroOfx('-1234.56')).toBe(-1234.56));
  it('vírgula decimal (banco brasileiro)', () => expect(numeroOfx('-1234,56')).toBe(-1234.56));
  it('milhar com ponto E decimal com vírgula', () => expect(numeroOfx('-1.234,56')).toBe(-1234.56));
  it('milhar com vírgula E decimal com ponto', () => expect(numeroOfx('1,234.56')).toBe(1234.56));
  it('texto que não é número vira nulo (não vira zero)', () => expect(numeroOfx('abc')).toBeNull());
});

describe('data do OFX', () => {
  it('AAAAMMDD', () => expect(dataOfx('20261029')?.getDate()).toBe(29));
  it('com hora e fuso', () => expect(dataOfx('20261029235900[-3:BRT]')?.getDate()).toBe(29));
  it('lixo vira nulo', () => expect(dataOfx('29/10/2026')).toBeNull());
});
