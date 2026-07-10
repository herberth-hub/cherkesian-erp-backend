import { dentroDoHorario } from './horario.util';

describe('dentroDoHorario', () => {
  it('retorna true quando dentro da janela normal', () => {
    expect(dentroDoHorario('10:00', '08:00', '18:00')).toBe(true);
    expect(dentroDoHorario('08:00', '08:00', '18:00')).toBe(true); // limite inferior
    expect(dentroDoHorario('18:00', '08:00', '18:00')).toBe(true); // limite superior
  });

  it('retorna false quando fora da janela normal', () => {
    expect(dentroDoHorario('07:59', '08:00', '18:00')).toBe(false);
    expect(dentroDoHorario('18:01', '08:00', '18:00')).toBe(false);
    expect(dentroDoHorario('23:30', '08:00', '18:00')).toBe(false);
  });

  it('sem horário cadastrado => sem restrição (true)', () => {
    expect(dentroDoHorario('03:00', null, null)).toBe(true);
    expect(dentroDoHorario('03:00', '08:00', null)).toBe(true);
    expect(dentroDoHorario('03:00', null, '18:00')).toBe(true);
  });

  it('suporta janela que cruza a meia-noite', () => {
    expect(dentroDoHorario('23:00', '22:00', '06:00')).toBe(true);
    expect(dentroDoHorario('02:00', '22:00', '06:00')).toBe(true);
    expect(dentroDoHorario('12:00', '22:00', '06:00')).toBe(false);
  });
});
