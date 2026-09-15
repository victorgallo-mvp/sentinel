/**
 * Janela do ciclo de faturamento do cliente.
 * As bordas (dia inexistente no mês, virada de ano, véspera da virada) são onde
 * esse tipo de cálculo costuma errar — por isso estão fixadas aqui.
 */
import { describe, it, expect } from 'vitest';
import { janelaCicloAtual, rotuloCiclo } from '../src/shared/ciclo.js';

const em = (iso) => new Date(`${iso}T12:00:00Z`);
const janela = (dia, iso) => {
  const { since, until } = janelaCicloAtual(dia, em(iso));
  return `${since}..${until}`;
};

describe('janelaCicloAtual', () => {
  it('dia 1 equivale ao mês-calendário', () => {
    expect(janela(1, '2026-09-15')).toBe('2026-09-01..2026-09-30');
    expect(janela(1, '2026-02-10')).toBe('2026-02-01..2026-02-28');
  });

  it('fecha na véspera da virada seguinte', () => {
    // "do 10 ao 10": o dia 10 do mês seguinte já é o próximo ciclo
    expect(janela(10, '2026-09-15')).toBe('2026-09-10..2026-10-09');
  });

  it('antes da virada, o ciclo vigente começou no mês anterior', () => {
    expect(janela(10, '2026-09-05')).toBe('2026-08-10..2026-09-09');
  });

  it('no próprio dia da virada, já conta o ciclo novo', () => {
    expect(janela(15, '2026-09-15')).toBe('2026-09-15..2026-10-14');
    expect(janela(15, '2026-09-14')).toBe('2026-08-15..2026-09-14');
  });

  it('ancora no último dia quando o dia não existe no mês', () => {
    // abril tem 30 dias: a virada de "dia 31" acontece em 30/04
    expect(janela(31, '2026-04-10')).toBe('2026-03-31..2026-04-29');
    // fevereiro de 2026 tem 28 dias
    expect(janela(30, '2026-02-10')).toBe('2026-01-30..2026-02-27');
  });

  it('atravessa a virada de ano', () => {
    expect(janela(10, '2026-01-05')).toBe('2025-12-10..2026-01-09');
    expect(janela(10, '2026-12-20')).toBe('2026-12-10..2027-01-09');
  });

  it('trata dia inválido como mês-calendário', () => {
    expect(janela(0, '2026-09-15')).toBe('2026-09-01..2026-09-30');
    expect(janela(99, '2026-09-15')).toBe('2026-09-01..2026-09-30');
    expect(janela(undefined, '2026-09-15')).toBe('2026-09-01..2026-09-30');
  });
});

describe('rotuloCiclo', () => {
  it('formata o período em dd/mm', () => {
    expect(rotuloCiclo(10, em('2026-09-15'))).toBe('10/09 a 09/10');
    expect(rotuloCiclo(1, em('2026-09-15'))).toBe('01/09 a 30/09');
  });
});
