/**
 * Veredito ("% de melhoria"): comparação entre o período atual e o anterior.
 *
 * A parada de coleta de 03 a 08/09/2026 mostrou os dois modos de falha que
 * estes testes fixam — o período anterior vazio inflando o ganho, e o período
 * atual incompleto fabricando uma queda.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const respostas = { totalAtual: 0, totalAnterior: 0, diasAtual: 7, diasAnterior: 7 };
let chamadaTotal = 0;

vi.mock('../src/infra/postgres.js', () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes('count(DISTINCT')) {
      // primeira chamada = janela atual, segunda = anterior
      const dias = chamadaTotal % 2 === 0 ? respostas.diasAtual : respostas.diasAnterior;
      chamadaTotal++;
      return { rows: [{ dias }] };
    }
    const total = chamadaTotal % 2 === 0 ? respostas.totalAtual : respostas.totalAnterior;
    chamadaTotal++;
    return { rows: [{ total }] };
  }),
}));

const { computarVeredito } = await import('../src/core/analise/veredito.servico.js');

const PERFIL = { objetivos: [{ ordem: 1, chave: 'mensagem' }] };
const IDS = ['abc'];

beforeEach(() => {
  chamadaTotal = 0;
  Object.assign(respostas, { totalAtual: 0, totalAnterior: 0, diasAtual: 7, diasAnterior: 7 });
});

describe('computarVeredito', () => {
  it('omite o veredito quando o período anterior quase não teve coleta', async () => {
    // O caso real: 74 conversas contra 12, mas as 12 vieram de 1 dia medido de 7.
    Object.assign(respostas, { totalAtual: 74, totalAnterior: 12, diasAtual: 7, diasAnterior: 1 });
    expect(await computarVeredito(IDS, PERFIL)).toBeNull();
  });

  it('omite quando o período atual quase não teve coleta', async () => {
    Object.assign(respostas, { totalAtual: 10, totalAnterior: 100, diasAtual: 2, diasAnterior: 7 });
    expect(await computarVeredito(IDS, PERFIL)).toBeNull();
  });

  it('compara pela média diária, não pelo total, quando a cobertura é parcial', async () => {
    // Mesma média diária (10/dia) com períodos de tamanhos medidos diferentes:
    // o total cairia 30%, mas nada mudou de fato.
    Object.assign(respostas, { totalAtual: 50, totalAnterior: 70, diasAtual: 5, diasAnterior: 7 });
    const v = await computarVeredito(IDS, PERFIL);
    expect(v.scorePct).toBe(0);
    expect(v.direcao).toBe('estavel');
  });

  it('reporta melhora real quando a cobertura é completa dos dois lados', async () => {
    Object.assign(respostas, { totalAtual: 140, totalAnterior: 70, diasAtual: 7, diasAnterior: 7 });
    const v = await computarVeredito(IDS, PERFIL);
    expect(v.scorePct).toBe(100);
    expect(v.direcao).toBe('melhorou');
  });

  it('reporta piora real', async () => {
    Object.assign(respostas, { totalAtual: 35, totalAnterior: 70, diasAtual: 7, diasAnterior: 7 });
    const v = await computarVeredito(IDS, PERFIL);
    expect(v.scorePct).toBe(-50);
    expect(v.direcao).toBe('piorou');
  });

  it('devolve null quando não há dado em nenhum dos períodos', async () => {
    Object.assign(respostas, { totalAtual: 0, totalAnterior: 0 });
    expect(await computarVeredito(IDS, PERFIL)).toBeNull();
  });
});
