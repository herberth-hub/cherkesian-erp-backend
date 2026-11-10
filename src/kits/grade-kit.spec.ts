/**
 * A GRADE DO KIT — as regras puras, sem banco.
 *
 * O que estes testes seguram: que o kit antigo (um tamanho) continua se
 * comportando igual, que somar e tirar da grade fecha a conta, e que a
 * unificação recusa juntar o que não é o mesmo pacote. Errar aqui é mandar
 * peça a menos para a oficina ou esconder peça que está fora de casa.
 */
import {
  KitParaUnir,
  chaveDoPacote,
  descreverGrade,
  ehUnificado,
  gradeDoKit,
  linhasDaGrade,
  motivoNaoUnifica,
  normalizarGrade,
  ordenarTamanhos,
  resumoTamanhos,
  somarGrades,
  subtrairGrade,
  tirarDaGrade,
  totalPecas,
} from './grade-kit';

describe('normalizarGrade', () => {
  it('põe em maiúscula, apara espaço e descarta zero', () => {
    expect(normalizarGrade({ ' m ': 11, g: 6, gg: 0 })).toEqual({ M: 11, G: 6 });
  });

  it('soma tamanhos que só diferiam na caixa', () => {
    expect(normalizarGrade({ m: 5, M: 3 })).toEqual({ M: 8 });
  });

  it('recusa quantidade negativa, texto e nulo em vez de propagar NaN', () => {
    expect(normalizarGrade({ M: -4, G: 'dez' as unknown as number, GG: null as unknown as number })).toEqual({});
  });

  it('trunca fração: não existe meia peça', () => {
    expect(normalizarGrade({ M: 11.9 })).toEqual({ M: 11 });
  });

  it('não quebra com entrada que não é objeto', () => {
    expect(normalizarGrade(null)).toEqual({});
    expect(normalizarGrade('M:11')).toEqual({});
    expect(normalizarGrade([1, 2])).toEqual({});
  });
});

describe('ordem dos tamanhos', () => {
  it('segue a nomenclatura da casa, não o alfabeto', () => {
    expect(ordenarTamanhos(['G2', 'PP', 'GG', 'M', 'G'])).toEqual(['PP', 'M', 'G', 'GG', 'G2']);
  });

  it('tamanho numérico (36, 38, 40) entra em ordem numérica, no fim', () => {
    expect(ordenarTamanhos(['40', '36', 'M', '38'])).toEqual(['M', '36', '38', '40']);
  });

  it('resumo e descrição saem na mesma ordem', () => {
    const g = { GG: 3, M: 11, G: 6 };
    expect(resumoTamanhos(g)).toBe('M·G·GG');
    expect(descreverGrade(g)).toBe('M 11 · G 6 · GG 3');
  });

  it('grade vazia não vira string vazia na tela', () => {
    expect(resumoTamanhos({})).toBe('—');
  });
});

describe('gradeDoKit — o kit antigo continua funcionando', () => {
  it('kit de um tamanho vira grade de uma linha', () => {
    expect(gradeDoKit({ tamanho: 'M', pecasTotal: 11 })).toEqual({ M: 11 });
    expect(ehUnificado({ grade: null })).toBe(false);
  });

  it('kit com grade usa a grade, não o campo tamanho (que ali é só resumo)', () => {
    const kit = { grade: { M: 11, G: 6 }, tamanho: 'M·G', pecasTotal: 17 };
    expect(gradeDoKit(kit)).toEqual({ M: 11, G: 6 });
    expect(ehUnificado(kit)).toBe(true);
  });

  it('kit sem peça não inventa linha', () => {
    expect(gradeDoKit({ tamanho: 'M', pecasTotal: 0 })).toEqual({});
  });

  it('linhasDaGrade entrega pronto para a tabela', () => {
    expect(linhasDaGrade({ G: 6, M: 11 })).toEqual([{ tamanho: 'M', pecas: 11 }, { tamanho: 'G', pecas: 6 }]);
  });
});

describe('contas da grade', () => {
  it('somar fecha o total', () => {
    const s = somarGrades([{ M: 11 }, { G: 6 }, { M: 2, GG: 3 }]);
    expect(s).toEqual({ M: 13, G: 6, GG: 3 });
    expect(totalPecas(s)).toBe(22);
  });

  it('subtrair zera o tamanho em vez de deixá-lo com 0', () => {
    expect(subtrairGrade({ M: 11, G: 6 }, { M: 11 })).toEqual({ G: 6 });
  });

  it('subtrair nunca fica negativo', () => {
    expect(subtrairGrade({ M: 5 }, { M: 9 })).toEqual({});
  });

  it('tirar o que cabe e avisar o que falta — nos dois ao mesmo tempo', () => {
    const r = tirarDaGrade({ M: 11, G: 2 }, { M: 4, G: 6 });
    expect(r.tirado).toEqual({ M: 4, G: 2 });
    expect(r.falta).toEqual({ G: 4 });
  });

  it('pedir tamanho que o kit não tem é falta cheia, não erro silencioso', () => {
    expect(tirarDaGrade({ M: 11 }, { GG: 3 })).toEqual({ tirado: {}, falta: { GG: 3 } });
  });
});

const KIT: KitParaUnir = {
  id: 1, codigo: 'KIT-20261110-000001', opId: 42, cor: 'VERDE BANDEIRA',
  operacaoFaccao: 'Costura', faccaoNome: 'MARIA ISABEL', controleFaccao: null,
  status: 'aguardando_expedicao', tamanho: 'M', pecasTotal: 11, unificadoEmId: null,
};

describe('motivoNaoUnifica — só junta o que é o mesmo pacote', () => {
  const outro = (over: Partial<KitParaUnir>): KitParaUnir => ({ ...KIT, id: 2, codigo: 'KIT-20261110-000002', tamanho: 'G', ...over });

  it('deixa unificar dois kits iguais em tudo que importa', () => {
    expect(motivoNaoUnifica([KIT, outro({})])).toBeNull();
  });

  it('um kit só não é unificação', () => {
    expect(motivoNaoUnifica([KIT])).toMatch(/pelo menos dois/i);
  });

  it('recusa kit que JÁ SAIU para a oficina', () => {
    expect(motivoNaoUnifica([KIT, outro({ status: 'em_faccao' })])).toMatch(/não saiu para a oficina/i);
  });

  it('recusa kit que já está numa OS — a NF de remessa já aponta para ele', () => {
    expect(motivoNaoUnifica([KIT, outro({ controleFaccao: 'OS-20261110-0001' })])).toMatch(/já está em uma OS/i);
  });

  it('recusa OPs diferentes: cada OP tem o seu corte e o seu lote', () => {
    expect(motivoNaoUnifica([KIT, outro({ opId: 99 })])).toMatch(/OPs diferentes/i);
  });

  it('recusa cores diferentes no mesmo pacote', () => {
    expect(motivoNaoUnifica([KIT, outro({ cor: 'PRETO' })])).toMatch(/Cores diferentes/i);
  });

  it('recusa operações diferentes: cada operação é uma OS', () => {
    expect(motivoNaoUnifica([KIT, outro({ operacaoFaccao: 'Estamparia' })])).toMatch(/Operações diferentes/i);
  });

  it('recusa destinos diferentes — é exatamente o caso que a unificação NÃO cobre', () => {
    expect(motivoNaoUnifica([KIT, outro({ faccaoNome: 'OUTRA OFICINA' })])).toMatch(/Destinos diferentes/i);
  });

  it('recusa kit que já foi absorvido por outro', () => {
    expect(motivoNaoUnifica([KIT, outro({ unificadoEmId: 7 })])).toMatch(/já foi unificado/i);
  });

  it('cor e facção comparam sem ligar para caixa e espaço', () => {
    expect(motivoNaoUnifica([KIT, outro({ cor: ' verde bandeira ', faccaoNome: 'maria isabel' })])).toBeNull();
  });

  it('dois kits ainda sem facção definida contam como o mesmo destino', () => {
    const semFac = { ...KIT, faccaoNome: null };
    expect(motivoNaoUnifica([semFac, { ...semFac, id: 2, codigo: 'KIT-2' }])).toBeNull();
  });
});

describe('chaveDoPacote', () => {
  it('kits do mesmo pacote caem na mesma chave', () => {
    expect(chaveDoPacote(KIT)).toBe(chaveDoPacote({ ...KIT, id: 2, tamanho: 'GG', cor: 'verde bandeira ' }));
  });

  it('destino diferente, chave diferente', () => {
    expect(chaveDoPacote(KIT)).not.toBe(chaveDoPacote({ ...KIT, faccaoNome: 'OUTRA' }));
  });
});
