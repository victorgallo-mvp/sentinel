import { describe, it, expect } from 'vitest';
import {
  calcularMedia,
  calcularDesvioPadrao,
  calcularEstatisticas,
  calcularMagnitudeDesvios,
  arredondar,
  arredondarParaIntervalo,
} from '../src/shared/utils.js';

describe('calcularMedia', () => {
  it('calcula a média de uma lista de números', () => {
    expect(calcularMedia([1, 2, 3, 4])).toBe(2.5);
  });

  it('retorna 0 para lista vazia ou nula', () => {
    expect(calcularMedia([])).toBe(0);
    expect(calcularMedia(null)).toBe(0);
  });
});

describe('calcularDesvioPadrao', () => {
  it('calcula o desvio padrão populacional', () => {
    expect(calcularDesvioPadrao([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
  });

  it('retorna 0 para listas com menos de 2 valores', () => {
    expect(calcularDesvioPadrao([5])).toBe(0);
    expect(calcularDesvioPadrao([])).toBe(0);
  });
});

describe('calcularEstatisticas', () => {
  it('descarta valores não numéricos e calcula min/max/quantidade', () => {
    const stats = calcularEstatisticas([10, 20, 'x', 30]);
    expect(stats.quantidade).toBe(3);
    expect(stats.minimo).toBe(10);
    expect(stats.maximo).toBe(30);
    expect(stats.media).toBe(20);
  });

  it('retorna estatísticas zeradas para entrada vazia', () => {
    expect(calcularEstatisticas([])).toEqual({ media: 0, desvioPadrao: 0, minimo: 0, maximo: 0, quantidade: 0 });
  });
});

describe('calcularMagnitudeDesvios', () => {
  it('calcula quantos desvios padrão um valor está da média', () => {
    expect(calcularMagnitudeDesvios(120, 100, 10)).toBe(2);
    expect(calcularMagnitudeDesvios(80, 100, 10)).toBe(2);
  });

  it('retorna 0 quando o desvio padrão é 0', () => {
    expect(calcularMagnitudeDesvios(120, 100, 0)).toBe(0);
  });
});

describe('arredondar', () => {
  it('arredonda para o número de casas decimais informado', () => {
    expect(arredondar(1.23456, 2)).toBe(1.23);
    expect(arredondar(1.005, 2)).toBe(1);
  });

  it('trata valores não numéricos como 0', () => {
    expect(arredondar('abc')).toBe(0);
  });
});

describe('arredondarParaIntervalo', () => {
  it('arredonda a data para o múltiplo de minutos anterior', () => {
    const data = new Date('2026-01-01T10:07:32Z');
    const arredondada = arredondarParaIntervalo(data, 5);
    expect(arredondada.toISOString()).toBe('2026-01-01T10:05:00.000Z');
  });
});
