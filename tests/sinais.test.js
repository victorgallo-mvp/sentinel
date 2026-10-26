/**
 * Motor de sinais: resolução do que é "resultado" e as regras, com janelas
 * sintéticas. Tudo puro, sem banco.
 */
import { describe, it, expect } from 'vitest';
import { resolverResultado, mapaObjetivoOtimizacao } from '../src/core/sinais/resolucao-resultado.js';
import {
  gastoSemResultado, custoResultadoSubindo, fadigaCriativo, conversasSemResposta,
  rastreamentoAusente, edicaoExcessiva, ritmoPlanejado,
} from '../src/core/sinais/regras.js';
import { somarJanela } from '../src/core/sinais/motor-sinais.servico.js';

const conversas = { metrica: 'messaging_conversations_started', origem: 'meta', rotulo: 'conversas' };

describe('resolverResultado', () => {
  it('objetivo de otimização do conjunto vence o perfil e os dados', () => {
    const r = resolverResultado({ optimizationGoal: 'CONVERSATIONS', perfil: { objetivos: [{ ordem: 1, chave: 'conversao' }] }, metricasComDado: new Set(['conversions']) });
    expect(r).toMatchObject({ metrica: 'messaging_conversations_started', origem: 'meta' });
  });

  it('campanha de vendas que otimiza para conversas é avaliada por conversas', () => {
    expect(resolverResultado({ optimizationGoal: 'CONVERSATIONS', perfil: {} }).metrica).toBe('messaging_conversations_started');
    expect(resolverResultado({ optimizationGoal: 'OFFSITE_CONVERSIONS', perfil: {} }).metrica).toBe('conversions');
    expect(resolverResultado({ optimizationGoal: 'LINK_CLICKS', perfil: {} }).metrica).toBe('inline_link_clicks');
  });

  it('sem objetivo na Meta, usa o onboarding; sem onboarding, o que tem dado; senão proxy', () => {
    expect(resolverResultado({ optimizationGoal: null, perfil: { objetivos: [{ ordem: 1, chave: 'lead' }] } })).toMatchObject({ metrica: 'leads', origem: 'onboarding' });
    expect(resolverResultado({ optimizationGoal: null, perfil: {}, metricasComDado: new Set(['inline_link_clicks', 'messaging_conversations_started']) })).toMatchObject({ metrica: 'messaging_conversations_started', origem: 'dados' });
    expect(resolverResultado({ optimizationGoal: null, perfil: {} })).toMatchObject({ metrica: 'inline_link_clicks', origem: 'proxy' });
  });

  it('anúncio herda do conjunto; campanha recebe o objetivo mais comum dos conjuntos', () => {
    const ents = [
      { _id: 'c1', tipo: 'campaign', metaId: 'C1' },
      { _id: 's1', tipo: 'adset', metaId: 'S1', optimizationGoal: 'CONVERSATIONS', hierarquia: { campanhaId: 'C1' } },
      { _id: 's2', tipo: 'adset', metaId: 'S2', optimizationGoal: 'CONVERSATIONS', hierarquia: { campanhaId: 'C1' } },
      { _id: 's3', tipo: 'adset', metaId: 'S3', optimizationGoal: 'LINK_CLICKS', hierarquia: { campanhaId: 'C1' } },
      { _id: 'a1', tipo: 'ad', metaId: 'A1', hierarquia: { campanhaId: 'C1', adsetId: 'S3' } },
    ];
    const m = mapaObjetivoOtimizacao(ents);
    expect(m.get('a1')).toBe('LINK_CLICKS');
    expect(m.get('c1')).toBe('CONVERSATIONS');
  });
});

describe('regras', () => {
  it('gasto sem resultado exige gasto mínimo, zero resultado e métrica presente', () => {
    expect(gastoSemResultado({ tres: { spend: 20, messaging_conversations_started: 0 }, resultado: conversas })).toBeNull();
    expect(gastoSemResultado({ tres: { spend: 90, messaging_conversations_started: 2 }, resultado: conversas })).toBeNull();
    expect(gastoSemResultado({ tres: { spend: 90 }, resultado: conversas })).toBeNull(); // métrica nunca coletada
    const s = gastoSemResultado({ tres: { spend: 90, messaging_conversations_started: 0 }, resultado: conversas });
    expect(s).toMatchObject({ tipo: 'gasto_sem_resultado', severidade: 'media', desperdicioDia: 30 });
    expect(gastoSemResultado({ tres: { spend: 150, messaging_conversations_started: 0 }, resultado: conversas }).severidade).toBe('alta');
  });

  it('custo por resultado subindo compara 7d com a base de 30d', () => {
    const base = { spend: 300, messaging_conversations_started: 100 }; // R$ 3,00
    expect(custoResultadoSubindo({ recente: { spend: 70, messaging_conversations_started: 20 }, base, resultado: conversas })).toBeNull(); // 3,50
    const s = custoResultadoSubindo({ recente: { spend: 70, messaging_conversations_started: 10 }, base, resultado: conversas }); // 7,00
    expect(s).toMatchObject({ tipo: 'custo_resultado_subindo', severidade: 'alta' });
    expect(s.desperdicioDia).toBeCloseTo(((7 - 3) * 10) / 7, 2);
  });

  it('fadiga precisa de frequência, queda de CTR e alta de CPM juntas', () => {
    const base = { spend: 300, impressions: 30000, inline_link_clicks: 600 }; // CTR 2%, CPM 10
    const recente = { spend: 84, impressions: 7000, inline_link_clicks: 100 }; // CTR 1,43%, CPM 12
    expect(fadigaCriativo({ recente, base, frequencia7d: 2.5 })).toBeNull();
    const s = fadigaCriativo({ recente, base, frequencia7d: 3.4 });
    expect(s.tipo).toBe('fadiga_criativo');
    expect(s.desperdicioDia).toBeCloseTo((84 / 7) * (1 - 10 / 12), 2);
  });

  it('conversas sem resposta só quando a métrica de resposta foi coletada', () => {
    expect(conversasSemResposta({ recente: { spend: 100, messaging_conversations_started: 40 }, resultado: conversas })).toBeNull();
    const s = conversasSemResposta({ recente: { spend: 140, messaging_conversations_started: 40, messaging_first_reply: 8 }, resultado: conversas });
    expect(s).toMatchObject({ tipo: 'conversas_sem_resposta', severidade: 'alta' });
    expect(s.desperdicioDia).toBeCloseTo(20 * 0.8, 2);
  });

  it('rastreamento ausente só para quem otimiza para compras pela Meta', () => {
    const compras = { metrica: 'conversions', origem: 'meta', rotulo: 'compras' };
    expect(rastreamentoAusente({ trintaDias: { spend: 500, conversions: 0 }, resultado: compras }).severidade).toBe('alta');
    expect(rastreamentoAusente({ trintaDias: { spend: 500, conversions: 3 }, resultado: compras })).toBeNull();
    expect(rastreamentoAusente({ trintaDias: { spend: 500 }, resultado: { ...compras, origem: 'onboarding' } })).toBeNull();
  });

  it('edição excessiva conta alterações humanas em 7 dias', () => {
    const alt = (c) => ({ categoria: c, ocorridaEm: new Date() });
    expect(edicaoExcessiva({ alteracoes7d: [alt('orcamento'), alt('status')] })).toBeNull();
    const s = edicaoExcessiva({ alteracoes7d: [alt('orcamento'), alt('orcamento'), alt('segmentacao'), alt('status'), alt('status')] });
    expect(s.tipo).toBe('edicao_excessiva');
    expect(s.evidencia.porCategoria.orcamento).toBe(2);
  });

  it('ritmo projeta o fim do mês e só avisa a partir de 15% de desvio', () => {
    expect(ritmoPlanejado({ gastoMes: 1000, mediaDiaria7d: 100, diaDoMes: 10, diasNoMes: 30, planejado: 3000 })).toBeNull(); // 3000
    const acima = ritmoPlanejado({ gastoMes: 1000, mediaDiaria7d: 150, diaDoMes: 10, diasNoMes: 30, planejado: 3000 }); // 4000
    expect(acima).toMatchObject({ tipo: 'ritmo_acima_do_planejado', severidade: 'alta', desperdicioDia: null });
    expect(acima.evidencia.excessoDia).toBeCloseTo(1000 / 20, 2);
    expect(ritmoPlanejado({ gastoMes: 0, mediaDiaria7d: 0, diaDoMes: 10, diasNoMes: 30, planejado: 3000 })).toBeNull(); // conta parada
    expect(ritmoPlanejado({ gastoMes: 500, mediaDiaria7d: 50, diaDoMes: 10, diasNoMes: 30, planejado: 3000 }).tipo).toBe('ritmo_abaixo_do_planejado');
    expect(ritmoPlanejado({ gastoMes: 500, mediaDiaria7d: 50, diaDoMes: 2, diasNoMes: 30, planejado: 3000 })).toBeNull(); // cedo demais
  });
});

describe('somarJanela', () => {
  it('soma só os dias dentro do intervalo e mantém ausente o que não foi coletado', () => {
    const serie = [
      { dia: '2026-10-20', spend: 10, conversions: 1 },
      { dia: '2026-10-21', spend: 20 },
      { dia: '2026-10-22', spend: 30, conversions: 0 },
    ];
    const s = somarJanela(serie, new Date('2026-10-21T03:00:00Z'), new Date('2026-10-23T03:00:00Z'));
    expect(s.spend).toBe(50);
    expect(s.conversions).toBe(0);
    expect('messaging_first_reply' in s).toBe(false);
  });
});
