import {
  fatorVencimento, mod10, dvCodigoBarras, dvNossoNumeroSantander, codigoBarrasELinha,
  gerarRemessaSantander240, lerRetornoSantander240, LIQUIDACOES, CedenteSantander, TituloRemessa,
} from './santander240';

const ced: CedenteSantander = {
  cnpj: '45704956000102', nome: 'HC QUALITY CORPORATE', agencia: '4338', agenciaDv: '0', conta: '130019372', contaDv: '5',
  codigoCedente: '1234567', codigoTransmissao: null, carteira: '101', jurosMensal: 1, multaPercent: 2, diasProtesto: 0,
};
const venc = new Date(2026, 9, 15);

describe('CNAB 240 Santander — utilitários FEBRABAN', () => {
  it('fator de vencimento (03/07/2000 = 1000; reinício em 22/02/2025)', () => {
    expect(fatorVencimento(new Date(2000, 6, 3))).toBe('1000');
    expect(fatorVencimento(new Date(2025, 1, 21))).toBe('9999');
    expect(fatorVencimento(new Date(2025, 1, 22))).toBe('1000');
  });
  it('mod10 e DV geral batem com um boleto público (Bradesco 23793.38128 60007.827136 95000.063305 9 …)', () => {
    expect(mod10('237933812')).toBe('8');
    expect(mod10('6000782713')).toBe('6');
    expect(mod10('9500006330')).toBe('5');
    expect(dvCodigoBarras('2379' + '846600002688803381260007827139500006330')).toBe('9');
  });
  it('código de barras e linha digitável consistentes (campo livre Santander)', () => {
    const nn = '000000000123';
    const cb = codigoBarrasELinha(ced, nn, 1322.88, venc);
    expect(cb.codigoBarras).toMatch(/^\d{44}$/);
    expect(cb.codigoBarras.startsWith('0339')).toBe(true);
    expect(cb.codigoBarras.slice(5, 19)).toBe(fatorVencimento(venc) + '0000132288');
    expect(cb.codigoBarras.slice(19)).toBe('9' + '1234567' + nn + dvNossoNumeroSantander(nn) + '0' + '101');
    expect(dvCodigoBarras(cb.codigoBarras.slice(0, 4) + cb.codigoBarras.slice(5))).toBe(cb.codigoBarras[4]);
    const ld = cb.linhaDigitavel.replace(/\D/g, '');
    expect(ld).toHaveLength(47);
    expect(mod10(ld.slice(0, 9))).toBe(ld[9]);
    expect(mod10(ld.slice(10, 20))).toBe(ld[20]);
    expect(mod10(ld.slice(21, 31))).toBe(ld[31]);
    expect(ld[32]).toBe(cb.codigoBarras[4]);
    expect(ld.slice(33)).toBe(cb.codigoBarras.slice(5, 19));
  });
});

describe('CNAB 240 Santander — remessa e retorno', () => {
  const titulo: TituloRemessa = {
    nossoNumero: '000000000123', seuNumero: 'NF2735', valor: 1322.88, vencimento: venc, emissao: new Date(2026, 8, 16),
    sacado: { tipo: 'CNPJ', documento: '01597589000209', nome: 'CONSIGAZ DISTRIBUIDORA DE GAS', endereco: 'RUA JOSE PEREIRA SOBRINHO, 485', bairro: 'CENTRO', cep: '06463283', cidade: 'BARUERI', uf: 'SP' },
  };
  it('gera arquivo com linhas de 240, estrutura 0/1/P/Q/R/5/9 e contadores corretos', () => {
    const rem = gerarRemessaSantander240(ced, [titulo], 7, new Date(2026, 8, 16));
    const linhas = rem.conteudo.split('\r\n').filter(Boolean);
    expect(linhas.every((l) => l.length === 240)).toBe(true);
    expect(linhas.map((l) => (l[7] === '3' ? l[13] : l[7])).join('')).toBe('01PQR59');
    expect(linhas[0].slice(0, 3)).toBe('033');
    expect(linhas[0].slice(157, 163)).toBe('000007');
    expect(linhas[0].slice(163, 166)).toBe('040');
    expect(linhas[0].slice(17, 32)).toBe('045704956000102');
    const P = linhas[2];
    expect(P.slice(44, 57)).toBe('000000000123' + dvNossoNumeroSantander('000000000123'));
    expect(P.slice(79, 87)).toBe('15102026');
    expect(P.slice(87, 102)).toBe('000000000132288');
    expect(P[119]).toBe('1'); // juros código 1 = valor por dia
    const Q = linhas[3];
    expect(Q[17]).toBe('2');
    expect(Q.slice(18, 33)).toBe('001597589000209');
    expect(Q.slice(128, 136)).toBe('06463283');
    expect(linhas[5].slice(17, 23)).toBe('000005');
    expect(linhas[6].slice(23, 29)).toBe('000007');
    expect(rem.nomeArquivo).toMatch(/^CB1609\d\d\.REM$/);
  });
  it('lê um retorno sintético (T + U) com liquidação, valores e datas', () => {
    const set = (arr: string[], pos: number, txt: string) => { for (let i = 0; i < txt.length; i++) arr[pos - 1 + i] = txt[i]; };
    const dv = dvNossoNumeroSantander('000000000123');
    const hdr = ('033' + '0000' + '0' + ' '.repeat(8) + '2' + '045704956000102' + ' '.repeat(40) + 'HC'.padEnd(30) + 'BANCO SANTANDER'.padEnd(30) + ' '.repeat(10) + '2' + '17092026' + ' '.repeat(6) + '000012' + '040').padEnd(240);
    const T = ' '.repeat(240).split(''); set(T, 1, '033'); set(T, 4, '0001'); set(T, 8, '3'); set(T, 9, '00001'); set(T, 14, 'T'); set(T, 16, '06');
    set(T, 45, '000000000123' + dv); set(T, 59, 'NF2735'.padEnd(15)); set(T, 74, '15102026'); set(T, 82, '000000000132288'); set(T, 199, '000000000000250'); set(T, 214, '0000000000');
    const U = ' '.repeat(240).split(''); set(U, 1, '033'); set(U, 4, '0001'); set(U, 8, '3'); set(U, 9, '00002'); set(U, 14, 'U'); set(U, 16, '06');
    set(U, 18, '000000000001000'); set(U, 78, '000000000133288'); set(U, 93, '000000000133038'); set(U, 138, '20102026'); set(U, 146, '21102026');
    const ret = lerRetornoSantander240([hdr, T.join(''), U.join('')].join('\r\n'));
    expect(ret.banco).toBe('033');
    expect(ret.nsa).toBe('000012');
    expect(ret.ocorrencias).toHaveLength(1);
    const o = ret.ocorrencias[0];
    expect(o.nossoNumero).toBe('000000000123');
    expect(o.nossoNumeroDv).toBe(dv);
    expect(o.seuNumero).toBe('NF2735');
    expect(LIQUIDACOES.has(o.codigo)).toBe(true);
    expect([o.valorTitulo, o.valorPago, o.juros, o.tarifa]).toEqual([1322.88, 1332.88, 10, 2.5]);
    expect(o.dataOcorrencia?.getDate()).toBe(20);
    expect(o.dataCredito?.getDate()).toBe(21);
  });
});
