'use strict';

/**
 * Expediente dos agentes no fuso da empresa (padrão: seg–sex, 06:30–22:00, America/Sao_Paulo).
 */

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Data/hora local no fuso: { data: 'AAAA-MM-DD', hora: 'HH:MM', diaSemana: 0-6, minutos } */
function local(agora, fuso) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const hora = `${partes.hour}:${partes.minute}`;
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    hora,
    diaSemana: DIAS[partes.weekday],
    minutos: Number(partes.hour) * 60 + Number(partes.minute),
  };
}

const paraMinutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function dentroDoExpediente(agora, { fuso, expediente }) {
  const l = local(agora, fuso);
  return expediente.dias.includes(l.diaSemana) && l.minutos >= paraMinutos(expediente.abre) && l.minutos < paraMinutos(expediente.fecha);
}

module.exports = { local, paraMinutos, dentroDoExpediente };
