import { describe, it, expect } from 'vitest';
import { resolverSensibilidade, metricaIgnorada } from '../src/core/deteccao/configurador-thresholds.js';

describe('resolverSensibilidade', () => {
  it('prioriza a sensibilidade customizada da entidade', () => {
    const conta = { configuracoes: { sensibilidadePadrao: 2.5 } };
    const entidade = { configuracoes: { sensibilidadeCustom: 4 } };
    expect(resolverSensibilidade(conta, entidade, 'ctr')).toBe(4);
  });

  it('usa a sensibilidade padrão da conta quando não há override na entidade', () => {
    const conta = { configuracoes: { sensibilidadePadrao: 1.8 } };
    const entidade = {};
    expect(resolverSensibilidade(conta, entidade, 'ctr')).toBe(1.8);
  });

  it('cai pro padrão por métrica quando a conta não define sensibilidade', () => {
    const conta = {};
    const entidade = {};
    expect(resolverSensibilidade(conta, entidade, 'ctr')).toBe(3.0);
    expect(resolverSensibilidade(conta, entidade, 'spend')).toBe(2.5);
  });
});

describe('metricaIgnorada', () => {
  it('retorna true quando a métrica está na lista de ignoradas da entidade', () => {
    const entidade = { configuracoes: { metricasIgnoradas: ['frequency', 'reach'] } };
    expect(metricaIgnorada(entidade, 'frequency')).toBe(true);
    expect(metricaIgnorada(entidade, 'spend')).toBe(false);
  });

  it('retorna false quando a entidade não define a lista', () => {
    expect(metricaIgnorada({}, 'spend')).toBe(false);
  });
});
