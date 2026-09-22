/**
 * Triagem de performance: as partes determinísticas.
 *
 * A análise em si é do modelo, mas os números que ela recebe e a validação do
 * que ela devolve são código — e é aí que erro passa despercebido.
 */
import { describe, it, expect } from 'vitest';
import { variacaoPct, dividir } from '../src/core/analise/comparativo-conta.servico.js';
import { interpretarResposta } from '../src/core/analise/triagem-performance.agente.js';

describe('variacaoPct', () => {
  it('calcula a variação normal', () => {
    expect(variacaoPct(150, 100)).toBe(50);
    expect(variacaoPct(50, 100)).toBe(-50);
  });

  it('devolve null quando o período anterior é zero', () => {
    // O veredito antigo devolvia 100 aqui, o que parecia "dobrou" mas era um
    // teto arbitrário: variação a partir de zero não é medida.
    expect(variacaoPct(26, 0)).toBeNull();
  });

  it('devolve null quando falta um dos lados', () => {
    expect(variacaoPct(10, null)).toBeNull();
    expect(variacaoPct(null, 10)).toBeNull();
  });

  it('zero contra zero é null, não 0%', () => {
    expect(variacaoPct(0, 0)).toBeNull();
  });
});

describe('dividir', () => {
  it('divide e aplica o fator', () => {
    expect(dividir(50, 1000, 100)).toBe(5);      // CTR
    expect(dividir(100, 40)).toBe(2.5);          // custo por resultado
  });

  it('devolve null em vez de dividir por zero', () => {
    expect(dividir(100, 0)).toBeNull();
    expect(dividir(0, 0)).toBeNull();
  });
});

describe('interpretarResposta', () => {
  const valida = '{"situacao":"atencao","resumo":"Conversas caindo","fatores":["a","b"],"acao":"revisar"}';

  it('lê a resposta bem formada', () => {
    const r = interpretarResposta(valida);
    expect(r).toEqual({ situacao: 'atencao', resumo: 'Conversas caindo', fatores: ['a', 'b'], acao: 'revisar' });
  });

  it('aceita a resposta embrulhada em cerca de código', () => {
    expect(interpretarResposta('```json\n' + valida + '\n```').situacao).toBe('atencao');
  });

  it('cai para "atencao" quando a situação não é uma das três', () => {
    expect(interpretarResposta('{"situacao":"otimo","resumo":"x","fatores":[]}').situacao).toBe('atencao');
  });

  it('descarta fatores que não são texto e limita a 5', () => {
    const r = interpretarResposta('{"situacao":"saudavel","resumo":"x","fatores":["a",null,42,"","b","c","d","e","f"]}');
    expect(r.fatores).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('normaliza ação ausente para null', () => {
    expect(interpretarResposta('{"situacao":"saudavel","resumo":"x","fatores":[]}').acao).toBeNull();
  });

  it('lança quando a resposta não é JSON — o chamador registra e pula a conta', () => {
    expect(() => interpretarResposta('desculpe, não consegui analisar')).toThrow();
  });
});
