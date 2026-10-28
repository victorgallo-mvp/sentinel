/**
 * Motor de sinais: resolução do que é "resultado" e as regras, com janelas
 * sintéticas. Tudo puro, sem banco.
 */
import { describe, it, expect } from 'vitest';
import { resolverResultado, mapaObjetivoOtimizacao } from '../src/core/sinais/resolucao-resultado.js';
import {
  gastoSemResultado, custoResultadoSubindo, fadigaCriativo, fadigaIminente, quedaPerformance,
  conversasSemResposta, rastreamentoAusente, edicaoExcessiva, realocacaoOrcamento, ritmoPlanejado,
  CATEGORIA_SINAL, REGRAS_ENTIDADE, SUPRIME,
} from '../src/core/sinais/regras.js';
import { somarJanela, caminhoSinal } from '../src/core/sinais/motor-sinais.servico.js';

const conversas = { metrica: 'messaging_conversations_started', origem: 'meta', rotulo: 'conversas', rotuloSingular: 'conversa', genero: 'f' };

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
    expect(resolverResultado({ optimizationGoal: null, perfil: {} })).toMatchObject({ metrica: 'inline_link_clicks', origem: 'proxy', rotulo: 'cliques no link', rotuloSingular: 'clique no link' });
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
    expect(s.frase).toBe('gastou R$ 90,00 em 3 dias sem nenhuma conversa');
    expect(gastoSemResultado({ tres: { spend: 150, messaging_conversations_started: 0 }, resultado: conversas }).severidade).toBe('alta');
  });

  it('todo sinal explica a conta e sugere uma ação; gasto sem resultado cita o melhor irmão', () => {
    const s = gastoSemResultado({ tres: { spend: 90, messaging_conversations_started: 0 }, resultado: conversas, melhorIrmao: { nome: 'Quentes', cpr: 4.5 } });
    expect(s.explicacao).toContain('R$ 90,00 em 3 dias ÷ 3 = R$ 30,00');
    expect(s.sugestao).toContain('"Quentes"');
    expect(s.sugestao).toContain('R$ 4,50 por conversa');
    const sem = gastoSemResultado({ tres: { spend: 90, messaging_conversations_started: 0 }, resultado: conversas });
    expect(sem.sugestao).not.toContain('mesma campanha');
  });

  it('custo por resultado subindo compara 7d com a base de 30d', () => {
    const base = { spend: 300, messaging_conversations_started: 100 }; // R$ 3,00
    expect(custoResultadoSubindo({ recente: { spend: 70, messaging_conversations_started: 20 }, base, resultado: conversas })).toBeNull(); // 3,50
    const s = custoResultadoSubindo({ recente: { spend: 70, messaging_conversations_started: 10 }, base, resultado: conversas }); // 7,00
    expect(s).toMatchObject({ tipo: 'custo_resultado_subindo', severidade: 'alta' });
    expect(s.desperdicioDia).toBeCloseTo(((7 - 3) * 10) / 7, 2);
    expect(s.explicacao).toContain('R$ 4,00 × 10 conversas = R$ 40,00 na semana');
    expect(s.sugestao).toMatch(/Não houve alteração/);
    const comMexida = custoResultadoSubindo({ recente: { spend: 70, messaging_conversations_started: 10 }, base, resultado: conversas, alteracoes7d: [{ categoria: 'orcamento' }, { categoria: 'status' }] });
    expect(comMexida.sugestao).toContain('2 alterações');
  });

  it('queda de performance compara semana com semana e exige que ainda esteja piorando', () => {
    const anterior = { spend: 100, messaging_conversations_started: 20 }; // R$ 5,00
    const recente = { spend: 140, messaging_conversations_started: 20 };  // R$ 7,00 (+40%)
    expect(quedaPerformance({ recente, anterior, tres: { spend: 30, messaging_conversations_started: 10 }, resultado: conversas })).toBeNull(); // 3 dias a R$ 3: melhorou
    const s = quedaPerformance({ recente, anterior, tres: { spend: 60, messaging_conversations_started: 8 }, resultado: conversas }); // R$ 7,50
    expect(s).toMatchObject({ tipo: 'queda_performance', severidade: 'media', desperdicioDia: null });
    expect(s.evidencia.custoProjetado7d).toBeCloseTo(9, 2);
    expect(s.frase).toContain('R$ 5,00 para R$ 7,00');
    expect(quedaPerformance({ recente: { spend: 115, messaging_conversations_started: 20 }, anterior, tres: { spend: 60, messaging_conversations_started: 8 }, resultado: conversas })).toBeNull(); // +15%: abaixo do limiar
    expect(quedaPerformance({ recente, anterior: { spend: 20, messaging_conversations_started: 4 }, tres: recente, resultado: conversas })).toBeNull(); // semana anterior sem volume
  });

  it('fadiga precisa de frequência, queda de CTR e alta de CPM juntas', () => {
    const base = { spend: 300, impressions: 30000, inline_link_clicks: 600 }; // CTR 2%, CPM 10
    const recente = { spend: 84, impressions: 7000, inline_link_clicks: 100 }; // CTR 1,43%, CPM 12
    expect(fadigaCriativo({ recente, base, frequencia7d: 2.5 })).toBeNull();
    const s = fadigaCriativo({ recente, base, frequencia7d: 3.4 });
    expect(s.tipo).toBe('fadiga_criativo');
    expect(s.desperdicioDia).toBeCloseTo((84 / 7) * (1 - 10 / 12), 2);
    expect(s.explicacao).toContain('viu o anúncio 3,4 vezes');
  });

  it('fadiga iminente projeta quando a frequência cruza 3,0 pela subida dos últimos dias', () => {
    const recente = { spend: 84, impressions: 7000, inline_link_clicks: 100 };
    const base = { spend: 300, impressions: 30000, inline_link_clicks: 600 };
    const hist = [{ dia: '2026-10-20', frequency: 2.0 }, { dia: '2026-10-26', frequency: 2.6 }]; // +0,10/dia
    const anterior = { spend: 80, impressions: 6000 };
    const s = fadigaIminente({ recente, anterior, base, frequencia7d: 2.6, frequenciaHistorico: hist });
    expect(s).toMatchObject({ tipo: 'fadiga_iminente', severidade: 'media', desperdicioDia: null });
    expect(s.frase).toContain('frequência 2,6 e subindo 0,10 por dia');
    expect(fadigaIminente({ recente, anterior: {}, base, frequencia7d: 2.6, frequenciaHistorico: hist })).toBeNull(); // conjunto novo: janela enchendo
    expect(s.evidencia.diasAteSaturar).toBe(4);
    expect(s.frase).toContain('cerca de 4 dias');
    expect(s.frase).toContain('CTR do link já caiu 29%');
    expect(fadigaIminente({ recente, anterior, base, frequencia7d: 2.6, frequenciaHistorico: [{ dia: '2026-10-20', frequency: 2.55 }, { dia: '2026-10-26', frequency: 2.6 }] })).toBeNull(); // estável
    expect(fadigaIminente({ recente, anterior, base, frequencia7d: 3.2, frequenciaHistorico: hist })).toBeNull(); // já saturou: é fadiga, não previsão
    expect(fadigaIminente({ recente, anterior, base, frequencia7d: 1.5, frequenciaHistorico: hist })).toBeNull(); // longe
    expect(fadigaIminente({ recente, anterior, base, frequencia7d: 2.6, frequenciaHistorico: [hist[1]] })).toBeNull(); // sem histórico
  });

  it('conversas sem resposta só quando a métrica de resposta foi coletada', () => {
    expect(conversasSemResposta({ recente: { spend: 100, messaging_conversations_started: 40 }, resultado: conversas })).toBeNull();
    const s = conversasSemResposta({ recente: { spend: 140, messaging_conversations_started: 40, messaging_first_reply: 8 }, resultado: conversas });
    expect(s).toMatchObject({ tipo: 'conversas_sem_resposta', severidade: 'alta' });
    expect(s.desperdicioDia).toBeCloseTo(20 * 0.8, 2);
    expect(s.explicacao).toContain('Cada conversa custou R$ 3,50');
    expect(s.explicacao).toContain('32 sem resposta');
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
    expect(s.sugestao).toContain('Congelar');
  });

  it('realocação aponta o irmão mais caro e quanto renderia mover metade do gasto para o mais barato', () => {
    const compras = { metrica: 'conversions', origem: 'meta', rotulo: 'compras', rotuloSingular: 'compra', genero: 'f' };
    const irmaos = [
      { metaId: 'A', nome: 'Quentes', gasto7: 140, resultados7: 10 }, // R$ 14
      { metaId: 'B', nome: 'Aberto', gasto7: 210, resultados7: 6 },   // R$ 35
      { metaId: 'C', nome: 'Lookalike', gasto7: 70, resultados7: 4 }, // R$ 17,50: não é 1,5×
      { metaId: 'D', nome: 'Novo', gasto7: 20, resultados7: 0 },      // gasto baixo demais
    ];
    const s = realocacaoOrcamento({ irmaos, resultado: compras });
    expect(s).toMatchObject({ tipo: 'realocacao_orcamento', desperdicioDia: null });
    expect(s.evidencia.melhor.metaId).toBe('A');
    expect(s.evidencia.pior.metaId).toBe('B');
    expect(s.evidencia.moverDia).toBeCloseTo(15, 2);                  // 30/dia × 0,5
    expect(s.evidencia.economiaDia).toBeCloseTo(30 * (1 - 14 / 35), 2);
    expect(s.evidencia.ganhoSemana).toBeCloseTo((15 / 14 - 15 / 35) * 7, 2);
    expect(s.evidencia.outros).toEqual([]);
    expect(s.frase).toContain('"Aberto"');
    expect(s.frase).toContain('"Quentes"');
    expect(s.sugestao).toContain('até 20% por dia');
  });

  it('realocação trata irmão sem resultado como o pior e precisa de dois ativos', () => {
    const compras = { metrica: 'conversions', origem: 'meta', rotulo: 'compras', rotuloSingular: 'compra', genero: 'f' };
    const s = realocacaoOrcamento({ irmaos: [{ metaId: 'A', nome: 'Bom', gasto7: 140, resultados7: 10 }, { metaId: 'Z', nome: 'Zerado', gasto7: 70, resultados7: 0 }], resultado: compras, unidade: 'campanha' });
    expect(s.evidencia.pior).toMatchObject({ metaId: 'Z', custo: null });
    expect(s.evidencia.economiaDia).toBeCloseTo(10, 2);
    expect(s.frase).toMatch(/^campanha "Zerado" gastou R\$ 70,00 na semana sem nenhuma compra;/);
    expect(realocacaoOrcamento({ irmaos: [{ metaId: 'A', nome: 'Bom', gasto7: 140, resultados7: 10 }], resultado: compras })).toBeNull();
    expect(realocacaoOrcamento({ irmaos: [{ metaId: 'A', nome: 'X', gasto7: 140, resultados7: 2 }, { metaId: 'B', nome: 'Y', gasto7: 140, resultados7: 1 }], resultado: compras })).toBeNull(); // ninguém com volume
  });

  it('categorias e supressões cobrem todos os tipos emitidos', () => {
    const tipos = ['gasto_sem_resultado', 'custo_resultado_subindo', 'queda_performance', 'fadiga_criativo', 'fadiga_iminente', 'conversas_sem_resposta', 'rastreamento_ausente', 'edicao_excessiva', 'realocacao_orcamento'];
    for (const t of tipos) expect(CATEGORIA_SINAL[t]).toBeTruthy();
    expect(SUPRIME.fadiga_iminente).toBe('fadiga_criativo');
    expect(SUPRIME.queda_performance).toBe('custo_resultado_subindo');
    expect(REGRAS_ENTIDADE.adset.map((r) => r.name)).toEqual(['gastoSemResultado', 'custoResultadoSubindo', 'quedaPerformance', 'fadigaCriativo', 'fadigaIminente', 'conversasSemResposta', 'rastreamentoAusente', 'edicaoExcessiva']);
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

describe('caminhoSinal', () => {
  it('monta campanha › conjunto › anúncio conforme o nível', () => {
    expect(caminhoSinal({ nivel: 'ad', campanhaNome: 'Vendas', conjuntoNome: 'Quentes', entidadeNome: 'Vídeo 3' })).toBe('campanha "Vendas" › conjunto "Quentes" › anúncio "Vídeo 3"');
    expect(caminhoSinal({ nivel: 'adset', campanhaNome: 'Vendas', entidadeNome: 'Quentes' })).toBe('campanha "Vendas" › conjunto "Quentes"');
    expect(caminhoSinal({ nivel: 'campaign', campanhaNome: 'Vendas', entidadeNome: 'Vendas' })).toBe('campanha "Vendas"');
    expect(caminhoSinal({ nivel: 'conta', entidadeNome: 'Loja' })).toBe('Loja');
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
