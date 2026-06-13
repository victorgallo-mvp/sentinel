import { describe, it, expect } from 'vitest';
import { extrairValorAction, normalizarLinhaInsight, agregarLinhasHorarias } from '../src/core/coleta/normalizador.js';

describe('extrairValorAction', () => {
  it('extrai o valor de um action_type específico', () => {
    const acoes = [
      { action_type: 'omni_purchase', value: '10' },
      { action_type: 'link_click', value: '50' },
    ];
    expect(extrairValorAction(acoes, 'omni_purchase')).toBe(10);
  });

  it('retorna 0 quando o action_type não existe ou a lista é inválida', () => {
    expect(extrairValorAction([], 'omni_purchase')).toBe(0);
    expect(extrairValorAction(null, 'omni_purchase')).toBe(0);
  });
});

describe('normalizarLinhaInsight', () => {
  it('normaliza métricas básicas e recalcula conversão/custo/ROAS', () => {
    const linha = {
      impressions: '1000',
      spend: '50',
      clicks: '20',
      actions: [{ action_type: 'omni_purchase', value: '5' }],
      action_values: [{ action_type: 'omni_purchase', value: '250' }],
    };

    const resultado = normalizarLinhaInsight(linha);
    const porMetrica = Object.fromEntries(resultado.map((r) => [r.metrica, r.valor]));

    expect(porMetrica.impressions).toBe(1000);
    expect(porMetrica.spend).toBe(50);
    expect(porMetrica.conversions).toBe(5);
    expect(porMetrica.conversion_rate).toBeCloseTo(0.5, 5);
    expect(porMetrica.cost_per_conversion).toBe(10);
    expect(porMetrica.purchase_roas).toBe(5);
  });

  it('retorna lista vazia quando a linha é nula', () => {
    expect(normalizarLinhaInsight(null)).toEqual([]);
  });

  it('ignora campos nulos/inválidos', () => {
    const resultado = normalizarLinhaInsight({ impressions: null, spend: 'abc' });
    expect(resultado.find((r) => r.metrica === 'impressions')).toBeUndefined();
    expect(resultado.find((r) => r.metrica === 'spend')).toBeUndefined();
  });
});

describe('agregarLinhasHorarias', () => {
  it('soma contadores e recalcula razões agregadas', () => {
    const linhas = [
      { impressions: '500', reach: '400', clicks: '10', unique_clicks: '8', spend: '20' },
      { impressions: '500', reach: '400', clicks: '10', unique_clicks: '8', spend: '20' },
    ];

    const agregado = agregarLinhasHorarias(linhas);

    expect(agregado.impressions).toBe(1000);
    expect(agregado.spend).toBe(40);
    expect(agregado.ctr).toBeCloseTo(2, 5);
    expect(agregado.cpm).toBeCloseTo(40, 5);
  });

  it('retorna null para lista vazia', () => {
    expect(agregarLinhasHorarias([])).toBe(null);
    expect(agregarLinhasHorarias(null)).toBe(null);
  });
});
