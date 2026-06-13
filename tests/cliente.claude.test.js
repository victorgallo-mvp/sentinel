import { describe, it, expect } from 'vitest';
import { calcularCusto } from '../src/core/ia/cliente.claude.js';

describe('calcularCusto', () => {
  it('calcula o custo combinando tokens de entrada e saída pro Sonnet', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(calcularCusto(usage, 'claude-sonnet-4-5')).toBeCloseTo(3 + 15, 5);
  });

  it('calcula o custo pro Haiku considerando tokens de cache', () => {
    const usage = { input_tokens: 500_000, cache_read_input_tokens: 500_000, output_tokens: 200_000 };
    const esperado = (1_000_000 / 1_000_000) * 1.0 + (200_000 / 1_000_000) * 5.0;
    expect(calcularCusto(usage, 'claude-haiku-4-5')).toBeCloseTo(esperado, 5);
  });

  it('usa os preços do Sonnet como fallback pra modelo desconhecido', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(calcularCusto(usage, 'modelo-inexistente')).toBeCloseTo(3, 5);
  });
});
