/**
 * Agregação das métricas do dashboard: counters somam, gauges viram média,
 * razões são recalculadas dos componentes e o ROAS tem regra própria.
 *
 * Guarda a semântica que a leitura em lote (buscarMetricasIntervaloLote)
 * depende — a consulta mudou de uma-por-entidade para uma-para-todas, e o
 * resultado por entidade tem de continuar idêntico.
 */
import { describe, it, expect } from 'vitest';
import { agregarLinhasPeriodo } from '../src/api/rotas/dashboard.rota.js';

const linha = (metrica, valor) => ({ metrica, valor });

describe('agregarLinhasPeriodo', () => {
  it('devolve objeto vazio sem linhas', () => {
    expect(agregarLinhasPeriodo([])).toEqual({});
  });

  it('soma counters e tira média de gauges', () => {
    const r = agregarLinhasPeriodo([
      linha('spend', 10), linha('spend', 30),          // counter → soma
      linha('frequency', 2), linha('frequency', 4),    // gauge → média
    ]);
    expect(r.spend).toBe(40);
    expect(r.frequency).toBe(3);
  });

  it('recalcula CTR dos componentes somados, não como média das razões diárias', () => {
    // Dia de muito tráfego (1% de 10000) + dia de pouco (10% de 100).
    // Média simples das razões daria 5,5%; o correto é 110/10100 = 1,089%.
    const r = agregarLinhasPeriodo([
      linha('clicks', 100), linha('impressions', 10000), linha('ctr', 1),
      linha('clicks', 10),  linha('impressions', 100),   linha('ctr', 10),
    ]);
    expect(r.ctr).toBeCloseTo(1.0891, 3);
  });

  it('recalcula CPC como gasto total sobre cliques totais', () => {
    const r = agregarLinhasPeriodo([
      linha('spend', 100), linha('clicks', 50),
      linha('spend', 50),  linha('clicks', 100),
    ]);
    expect(r.cpc).toBeCloseTo(1.0, 6); // 150 / 150
  });

  it('mantém o ROAS do dia quando o período tem um dia só', () => {
    const r = agregarLinhasPeriodo([linha('purchase_roas', 3.5), linha('spend', 100)]);
    expect(r.purchase_roas).toBe(3.5);
  });

  it('recompõe o ROAS de vários dias por receita ÷ gasto', () => {
    const r = agregarLinhasPeriodo([
      linha('purchase_roas', 2), linha('purchase_revenue', 200), linha('spend', 100),
      linha('purchase_roas', 8), linha('purchase_revenue', 100), linha('spend', 100),
    ]);
    expect(r.purchase_roas).toBeCloseTo(1.5, 6); // 300 / 200 — não a média 5
  });

  it('omite o ROAS de vários dias quando não há receita coletada', () => {
    const r = agregarLinhasPeriodo([
      linha('purchase_roas', 2), linha('spend', 100),
      linha('purchase_roas', 300), linha('spend', 1),
    ]);
    expect(r.purchase_roas).toBeNull(); // média inflada seria 151
  });

  it('deixa o snapshot nativo da Meta sobrepor o valor calculado', () => {
    const r = agregarLinhasPeriodo(
      [linha('spend', 100), linha('purchase_roas', 2)],
      { purchase_roas: 4.2, purchase_revenue: 420 }
    );
    expect(r.purchase_roas).toBe(4.2);
    expect(r.purchase_revenue).toBe(420);
    expect(r.spend).toBe(100);
  });
});
