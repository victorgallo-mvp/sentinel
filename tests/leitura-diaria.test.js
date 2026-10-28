/**
 * Leitura diária: as partes determinísticas em volta do modelo — o JSON que
 * ele recebe, a validação do que devolve e a amarração das prioridades aos
 * sinais (com o impacto somado pelo sistema, não pelo modelo).
 */
import { describe, it, expect } from 'vitest';
import { interpretarResposta } from '../src/core/sinais/leitura-diaria.agente.js';
import { montarEntradaLeitura, amarrarPrioridades, valorDiaSinal, chaveSinal } from '../src/core/sinais/leitura-diaria.servico.js';

const conta = { nome: 'Horizon', perfil: { gerenteResponsavel: 'Ana', objetivos: [{ ordem: 1, chave: 'mensagem' }] } };
const sinais = [
  { tipo: 'custo_resultado_subindo', categoria: 'desperdicio', severidade: 'alta', nivel: 'adset', entidadeId: 'e1', entidadeNome: 'Stories 11', campanhaNome: 'ENG', metricaResultado: 'messaging_conversations_started', desperdicioDia: 7.73, frase: 'custo subiu', explicacao: 'x', sugestao: 'y', evidencia: {} },
  { tipo: 'queda_performance', categoria: 'previsao', severidade: 'media', nivel: 'adset', entidadeId: 'e2', entidadeNome: 'Stories 7', campanhaNome: 'ENG', metricaResultado: 'messaging_conversations_started', desperdicioDia: null, frase: 'piorando', evidencia: { extraProjetadoDia: 11.45 } },
  { tipo: 'realocacao_orcamento', categoria: 'orcamento', severidade: 'media', nivel: 'campaign', entidadeId: 'c1', entidadeNome: 'ENG', campanhaNome: 'ENG', metricaResultado: 'messaging_conversations_started', desperdicioDia: null, frase: 'mover', evidencia: { economiaDia: 8.85 } },
  { tipo: 'edicao_excessiva', categoria: 'operacao', severidade: 'media', nivel: 'adset', entidadeId: 'e3', entidadeNome: 'Stories 26', campanhaNome: 'ENG', metricaResultado: 'messaging_conversations_started', desperdicioDia: null, frase: '4 alterações', evidencia: {} },
];

describe('montarEntradaLeitura', () => {
  it('numera os sinais, traduz rótulos, soma os totais e inclui o caminho', () => {
    const e = montarEntradaLeitura({ conta, dia: '2026-10-28', sinais, vazandoOntemDia: 9.1 });
    expect(e.conta).toEqual({ nome: 'Horizon', gestor: 'Ana', objetivosDeclarados: ['conversas'] });
    expect(e.totais).toEqual({ sinais: 4, porCategoria: { desperdicio: 1, previsao: 1, orcamento: 1, operacao: 1 }, vazandoDia: 7.73, vazandoOntemDia: 9.1, recuperavelDia: 8.85 });
    expect(e.sinais.map((s) => s.ref)).toEqual(['s1', 's2', 's3', 's4']);
    expect(e.sinais[0]).toMatchObject({ categoria: 'Desperdício', tipo: 'Custo por resultado subindo', onde: 'campanha "ENG" › conjunto "Stories 11"', resultado: 'conversas', valorDia: 7.73, natureza: 'vazando' });
    expect(e.sinais[1]).toMatchObject({ valorDia: 11.45, natureza: 'projetado' });
    expect(e.sinais[2]).toMatchObject({ valorDia: 8.85, natureza: 'recuperavel', onde: 'campanha "ENG"' });
    expect(e.sinais[3]).toMatchObject({ valorDia: null, natureza: null });
    expect(e.leituraAnterior).toBeNull();
  });

  it('omite objetivos declarados quando o perfil não tem nenhum', () => {
    const e = montarEntradaLeitura({ conta: { nome: 'X', perfil: {} }, dia: '2026-10-28', sinais });
    expect(e.conta).toEqual({ nome: 'X', gestor: null });
    expect('objetivosDeclarados' in e.conta).toBe(false);
  });

  it('resume a leitura anterior a títulos', () => {
    const e = montarEntradaLeitura({ conta, dia: '2026-10-28', sinais, leituraAnterior: { resumo: 'ontem', prioridades: [{ titulo: 'A' }, { titulo: 'B' }] } });
    expect(e.leituraAnterior).toEqual({ resumo: 'ontem', prioridades: ['A', 'B'] });
  });
});

describe('interpretarResposta', () => {
  const refs = new Set(['s1', 's2', 's3', 's4']);

  it('aceita o formato esperado, com ou sem cerca de código, e numera as prioridades', () => {
    const texto = '```json\n' + JSON.stringify({ resumo: 'r', tendencia: 'piorando', prioridades: [{ titulo: 'T1', onde: 'o', porque: 'p', acao: 'a', refs: ['s1', 's2'] }, { titulo: 'T2', porque: 'p', acao: 'a', refs: ['s3'] }], observacao: null }) + '\n```';
    const r = interpretarResposta(texto, refs);
    expect(r.tendencia).toBe('piorando');
    expect(r.prioridades.map((p) => [p.ordem, p.titulo, p.refs])).toEqual([[1, 'T1', ['s1', 's2']], [2, 'T2', ['s3']]]);
    expect(r.prioridades[1].onde).toBeNull();
    expect(r.observacao).toBeNull();
  });

  it('derruba refs inventadas, prioridades sem ref, tendência desconhecida e excesso de prioridades', () => {
    const r = interpretarResposta(JSON.stringify({
      resumo: 'r', tendencia: 'explodindo',
      prioridades: [
        { titulo: 'ok', porque: 'p', acao: 'a', refs: ['s1', 's9'] },
        { titulo: 'sem ref', porque: 'p', acao: 'a', refs: ['s9'] },
        { titulo: 'b', porque: 'p', acao: 'a', refs: ['s2'] },
        { titulo: 'c', porque: 'p', acao: 'a', refs: ['s3'] },
        { titulo: 'd', porque: 'p', acao: 'a', refs: ['s4'] },
      ],
    }), refs);
    expect(r.tendencia).toBe('sem_base');
    expect(r.prioridades.map((p) => p.titulo)).toEqual(['ok', 'b', 'c']);
    expect(r.prioridades[0].refs).toEqual(['s1']);
  });

  it('falha em resposta que não é JSON', () => {
    expect(() => interpretarResposta('Claro! Aqui vai a leitura...', refs)).toThrow();
  });
});

describe('amarrarPrioridades', () => {
  it('soma o impacto pelos sinais citados: vazando vence, depois recuperável, depois projetado', () => {
    const entrada = montarEntradaLeitura({ conta, dia: '2026-10-28', sinais });
    const prioridades = [
      { ordem: 1, titulo: 'A', onde: null, porque: 'p', acao: 'a', refs: ['s1', 's2'] },
      { ordem: 2, titulo: 'B', onde: null, porque: 'p', acao: 'a', refs: ['s3'] },
      { ordem: 3, titulo: 'C', onde: null, porque: 'p', acao: 'a', refs: ['s2'] },
      { ordem: 4, titulo: 'D', onde: null, porque: 'p', acao: 'a', refs: ['s4'] },
    ];
    const r = amarrarPrioridades(prioridades, entrada, sinais);
    expect(r[0]).toMatchObject({ impactoDia: 7.73, natureza: 'vazando' });
    expect(r[0].sinais).toEqual([{ tipo: 'custo_resultado_subindo', entidadeId: 'e1', severidade: 'alta' }, { tipo: 'queda_performance', entidadeId: 'e2', severidade: 'media' }]);
    expect(r[1]).toMatchObject({ impactoDia: 8.85, natureza: 'recuperavel' });
    expect(r[2]).toMatchObject({ impactoDia: 11.45, natureza: 'projetado' });
    expect(r[3]).toMatchObject({ impactoDia: null, natureza: null });
  });
});

describe('utilitários', () => {
  it('valorDiaSinal e chaveSinal', () => {
    expect(valorDiaSinal({ desperdicioDia: 3.333 })).toEqual({ valorDia: 3.33, natureza: 'vazando' });
    expect(valorDiaSinal({ economiaDia: 2 })).toEqual({ valorDia: 2, natureza: 'recuperavel' });
    expect(chaveSinal({ tipo: 'x', entidadeId: 'y' })).toBe('x|y');
  });
});
