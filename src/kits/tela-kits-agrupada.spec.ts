/**
 * A TELA DE KITS AGRUPADA POR OS.
 *
 * Os kits novos já nascem num pacote só. Os antigos não dá para juntar — já
 * estão na oficina, com etiqueta impressa e NF de remessa emitida —, então a
 * tela passa a mostrar UMA linha por Ordem de Serviço.
 *
 * Estes testes rodam as funções que estão dentro do próprio index.html. Se
 * alguém mexer nelas e quebrar o agrupamento, a lista volta a ter 47 linhas
 * para 15 envios e o teste cai antes do Herberth ver.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

/** Recorta um trecho do index.html entre dois marcadores. */
function trecho(de: string, ate: string): string {
  const ini = html.indexOf(de);
  const fim = html.indexOf(ate, ini + 1);
  expect(ini).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(ini);
  return html.slice(ini, fim);
}

const codigo = [
  trecho('function kitGradeLinhas(', 'async function viewKits('),
  trecho('function kitsAgrupadosPorOs(', 'async function viewKits('),
].join('\n');

type Kit = Record<string, unknown>;
const carregar = () => new Function(
  'esc',
  `${codigo} return { kitGradeLinhas, kitGradeCelula, kitsAgrupadosPorOs, kitGrupoCelula };`,
)((v: unknown) => String(v ?? '')) as {
  kitGradeLinhas: (k: Kit) => Array<{ tamanho: string; pecas: number }>;
  kitGradeCelula: (k: Kit) => string;
  kitsAgrupadosPorOs: (ks: Kit[]) => Array<{ os: string | null; kits: Kit[] }>;
  kitGrupoCelula: (g: { kits: Kit[] }) => string;
};

const fn = carregar();

// A OS-20261028-0002 do print do Herberth: COLETE INTS, três kits, uma oficina.
const COLETE = [
  { codigo: 'KIT-20261028-000005', controleFaccao: 'OS-20261028-0002', tamanho: 'G', pecasTotal: 6, jogos: 6, status: 'em_faccao', faccaoNome: 'MARIA ISABEL DOS PASSOS', modelo: 'COLETE INTS ACI (PAI)' },
  { codigo: 'KIT-20261028-000006', controleFaccao: 'OS-20261028-0002', tamanho: 'M', pecasTotal: 11, jogos: 11, status: 'em_faccao', faccaoNome: 'MARIA ISABEL DOS PASSOS', modelo: 'COLETE INTS ACI (PAI)' },
  { codigo: 'KIT-20261028-000007', controleFaccao: 'OS-20261028-0002', tamanho: 'GG', pecasTotal: 3, jogos: 3, status: 'em_faccao', faccaoNome: 'MARIA ISABEL DOS PASSOS', modelo: 'COLETE INTS ACI (PAI)' },
];

describe('agrupar por Ordem de Serviço', () => {
  it('três linhas do mesmo envio viram uma', () => {
    const g = fn.kitsAgrupadosPorOs(COLETE);
    expect(g).toHaveLength(1);
    expect(g[0].os).toBe('OS-20261028-0002');
    expect(g[0].kits).toHaveLength(3);
  });

  it('a linha da OS soma a grade e as peças dos três', () => {
    const cel = fn.kitGrupoCelula(fn.kitsAgrupadosPorOs(COLETE)[0]);
    expect(cel).toContain('3 tamanhos');
    expect(cel).toContain('20p');
    expect(cel).toContain('G 6');
    expect(cel).toContain('M 11');
    expect(cel).toContain('GG 3');
  });

  it('OS diferentes NÃO se misturam, mesmo com o mesmo modelo e a mesma oficina', () => {
    const outros = COLETE.map((k) => ({ ...k, codigo: k.codigo + 'X', controleFaccao: 'OS-20261028-0003' }));
    const g = fn.kitsAgrupadosPorOs([...COLETE, ...outros]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.os)).toEqual(['OS-20261028-0002', 'OS-20261028-0003']);
  });

  it('kit que ainda não saiu (sem OS) continua tendo a sua própria linha', () => {
    const soltos = [{ codigo: 'KIT-A', controleFaccao: null, tamanho: 'M', pecasTotal: 5 }, { codigo: 'KIT-B', controleFaccao: '', tamanho: 'G', pecasTotal: 4 }];
    const g = fn.kitsAgrupadosPorOs(soltos);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.os === null && x.kits.length === 1)).toBe(true);
  });

  it('a ordem da lista é respeitada — a OS aparece onde apareceu o primeiro kit dela', () => {
    const misturado = [COLETE[0], { codigo: 'KIT-SOLTO', controleFaccao: null, tamanho: 'P', pecasTotal: 1 }, COLETE[1], COLETE[2]];
    const g = fn.kitsAgrupadosPorOs(misturado);
    expect(g.map((x) => x.os)).toEqual(['OS-20261028-0002', null]);
    expect(g[0].kits).toHaveLength(3);
  });
});

describe('a célula de tamanho na lista', () => {
  it('kit de um tamanho continua mostrando jogos e peças, como sempre', () => {
    expect(fn.kitGradeCelula({ tamanho: 'M', jogos: 11, pecasTotal: 11 })).toBe('<b>M</b> · 11j/11p');
  });

  it('kit unificado mostra a grade em vez de um tamanho inventado', () => {
    const cel = fn.kitGradeCelula({ tamanho: 'M·G·GG', grade: { M: 11, G: 6, GG: 3 }, gradeLinhas: [{ tamanho: 'M', pecas: 11 }, { tamanho: 'G', pecas: 6 }, { tamanho: 'GG', pecas: 3 }], jogos: 20, pecasTotal: 20 });
    expect(cel).toContain('3 tamanhos');
    expect(cel).toContain('20p');
    expect(cel).toContain('GG 3');
  });

  it('monta a grade a partir do objeto cru quando o servidor não mandou as linhas prontas', () => {
    const cel = fn.kitGradeCelula({ tamanho: 'M·G', grade: { M: 11, G: 6 }, pecasTotal: 17 });
    expect(cel).toContain('2 tamanhos');
    expect(cel).toContain('17p');
  });

  it('kit sem grade nenhuma não quebra a linha da tabela', () => {
    expect(fn.kitGradeLinhas({})).toEqual([{ tamanho: '—', pecas: 0 }]);
  });
});
