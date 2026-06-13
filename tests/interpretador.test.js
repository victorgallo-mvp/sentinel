import { describe, it, expect } from 'vitest';
import { interpretarResposta } from '../src/core/feedback/interpretador.js';

describe('interpretarResposta', () => {
  it('reconhece respostas de feedback útil', () => {
    expect(interpretarResposta('1').classificacao).toBe('util');
    expect(interpretarResposta('útil').classificacao).toBe('util');
  });

  it('reconhece respostas de feedback ruído', () => {
    expect(interpretarResposta('2').classificacao).toBe('ruido');
    expect(interpretarResposta('ruido').classificacao).toBe('ruido');
  });

  it('reconhece pedidos de snooze, inclusive com texto adicional', () => {
    const resultado = interpretarResposta('3 me avise só na semana que vem');
    expect(resultado.classificacao).toBe('parcial');
    expect(resultado.acao).toBe('snooze');
    expect(resultado.comentarioLivre).toBe('3 me avise só na semana que vem');
  });

  it('trata qualquer outro texto como comentário livre', () => {
    const resultado = interpretarResposta('acho que o criativo cansou');
    expect(resultado.classificacao).toBe('comentario');
    expect(resultado.acao).toBe(null);
    expect(resultado.comentarioLivre).toBe('acho que o criativo cansou');
  });
});
