import { abreviarCategoria, proximoCodigo } from './codigo.util';

describe('codigo.util', () => {
  it('abrevia categoria (3 chars, maiúsculo, sem acento)', () => {
    expect(abreviarCategoria('Camisa')).toBe('CAM');
    expect(abreviarCategoria('Tecido')).toBe('TEC');
    expect(abreviarCategoria('Malha')).toBe('MAL');
    expect(abreviarCategoria('Jaleco')).toBe('JAL');
    expect(abreviarCategoria('cão')).toBe('CAO'); // remove acento
  });

  it('gera o primeiro código quando não há existentes', () => {
    expect(proximoCodigo('PRD', 'Camisa', [])).toBe('PRD-CAM-0001');
  });

  it('incrementa a partir do maior sequencial da mesma categoria', () => {
    const existentes = ['PRD-CAM-0001', 'PRD-CAM-0002', 'PRD-CAL-0005'];
    expect(proximoCodigo('PRD', 'Camisa', existentes)).toBe('PRD-CAM-0003');
    expect(proximoCodigo('PRD', 'Calça', existentes)).toBe('PRD-CAL-0006');
  });

  it('não mistura prefixos diferentes', () => {
    const existentes = ['MP-TEC-0009'];
    expect(proximoCodigo('PRD', 'Tecido', existentes)).toBe('PRD-TEC-0001');
    expect(proximoCodigo('MP', 'Tecido', existentes)).toBe('MP-TEC-0010');
  });
});
