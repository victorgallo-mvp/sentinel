/**
 * Regras do motor de sinais. Funções puras: recebem janelas já somadas e
 * devolvem um sinal ou null. Nenhuma lê banco; é isso que as torna testáveis
 * e auditáveis — a frase e a evidência saem dos mesmos números.
 *
 * Convenções:
 * - `recente`: soma dos 7 dias que terminam anteontem (o último dia ainda
 *   recebe atribuição e distorceria qualquer razão).
 * - `base`: soma dos 30 dias anteriores à janela recente.
 * - `tres`: soma dos 3 dias que terminam anteontem.
 * - `desperdicioDia`: R$/dia estimado; null quando o sinal é qualitativo.
 */

export const LIMIARES = {
  gastoSemResultadoMin: 30,        // R$ em 3 dias sem nenhum resultado
  gastoSemResultadoAlta: 100,      // R$ a partir do qual a severidade é alta
  custoSubiuFator: 1.5,            // custo por resultado 7d ≥ 1,5× a base
  custoSubiuFatorAlta: 2.0,
  custoMinResultados7d: 5,
  custoMinResultadosBase: 10,
  custoMinGasto7d: 50,
  fadigaFrequencia: 3.0,
  fadigaQuedaCtr: 0.85,            // CTR do link 7d ≤ 85% da base
  fadigaAltaCpm: 1.15,             // CPM 7d ≥ 115% da base
  fadigaMinImpressoes7d: 2000,
  respostaMinConversas7d: 10,
  respostaTaxaMinima: 0.5,
  respostaTaxaAlta: 0.25,
  rastreamentoMinGasto30d: 100,
  edicoesMax7d: 4,
  ritmoDesvio: 0.15,
  ritmoDesvioAlta: 0.30,
};

const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const n2 = (v) => Number(Number(v).toFixed(2));

/** Gastou e não trouxe nenhum resultado em 3 dias. */
export function gastoSemResultado({ tres, resultado }) {
  const gasto = tres.spend ?? 0;
  if (gasto < LIMIARES.gastoSemResultadoMin) return null;
  if ((tres[resultado.metrica] ?? 0) > 0) return null;
  // Se a métrica de resultado nunca foi coletada nesta entidade, não dá para
  // afirmar zero. Proxy (cliques no link) está sempre presente.
  if (!(resultado.metrica in tres) && resultado.origem !== 'proxy') return null;
  return {
    tipo: 'gasto_sem_resultado',
    severidade: gasto >= LIMIARES.gastoSemResultadoAlta ? 'alta' : 'media',
    desperdicioDia: n2(gasto / 3),
    frase: `gastou ${reais(gasto)} em 3 dias sem nenhuma ${resultado.rotulo}`,
    evidencia: { gasto3d: n2(gasto), resultado3d: 0, metrica: resultado.metrica, origem: resultado.origem },
  };
}

/** Custo por resultado nos últimos 7 dias bem acima da própria média de 30 dias. */
export function custoResultadoSubindo({ recente, base, resultado }) {
  const res7 = recente[resultado.metrica] ?? 0;
  const resBase = base[resultado.metrica] ?? 0;
  const gasto7 = recente.spend ?? 0;
  if (res7 < LIMIARES.custoMinResultados7d || resBase < LIMIARES.custoMinResultadosBase || gasto7 < LIMIARES.custoMinGasto7d) return null;
  const cpr7 = gasto7 / res7;
  const cprBase = (base.spend ?? 0) / resBase;
  if (!(cprBase > 0) || cpr7 < LIMIARES.custoSubiuFator * cprBase) return null;
  const fator = cpr7 / cprBase;
  return {
    tipo: 'custo_resultado_subindo',
    severidade: fator >= LIMIARES.custoSubiuFatorAlta ? 'alta' : 'media',
    desperdicioDia: n2(((cpr7 - cprBase) * res7) / 7),
    frase: `custo por ${resultado.rotulo} subiu de ${reais(cprBase)} para ${reais(cpr7)} (+${Math.round((fator - 1) * 100)}%) nos últimos 7 dias`,
    evidencia: { custo7d: n2(cpr7), custoBase30d: n2(cprBase), resultados7d: res7, resultadosBase: resBase, gasto7d: n2(gasto7), metrica: resultado.metrica, origem: resultado.origem },
  };
}

/** Frequência alta, CTR do link caindo e CPM subindo ao mesmo tempo: o criativo cansou. */
export function fadigaCriativo({ recente, base, frequencia7d }) {
  const impr7 = recente.impressions ?? 0;
  const imprBase = base.impressions ?? 0;
  if (!(frequencia7d >= LIMIARES.fadigaFrequencia) || impr7 < LIMIARES.fadigaMinImpressoes7d || imprBase <= 0) return null;
  const ctr7 = (recente.inline_link_clicks ?? 0) / impr7;
  const ctrBase = (base.inline_link_clicks ?? 0) / imprBase;
  const cpm7 = ((recente.spend ?? 0) / impr7) * 1000;
  const cpmBase = ((base.spend ?? 0) / imprBase) * 1000;
  if (!(ctrBase > 0) || !(cpmBase > 0)) return null;
  if (ctr7 > LIMIARES.fadigaQuedaCtr * ctrBase || cpm7 < LIMIARES.fadigaAltaCpm * cpmBase) return null;
  const gastoDia = (recente.spend ?? 0) / 7;
  return {
    tipo: 'fadiga_criativo',
    severidade: frequencia7d >= 5 ? 'alta' : 'media',
    desperdicioDia: n2(gastoDia * (1 - cpmBase / cpm7)),
    frase: `frequência ${frequencia7d.toFixed(1)} em 7 dias, CTR do link caiu ${pct(1 - ctr7 / ctrBase)} e CPM subiu ${pct(cpm7 / cpmBase - 1)}: criativo saturado`,
    evidencia: { frequencia7d: n2(frequencia7d), ctrLink7d: n2(ctr7 * 100), ctrLinkBase: n2(ctrBase * 100), cpm7d: n2(cpm7), cpmBase: n2(cpmBase), gasto7d: n2(recente.spend ?? 0) },
  };
}

/** Conversas iniciadas que a empresa não respondeu. */
export function conversasSemResposta({ recente, resultado }) {
  if (resultado.metrica !== 'messaging_conversations_started') return null;
  const conversas = recente.messaging_conversations_started ?? 0;
  if (conversas < LIMIARES.respostaMinConversas7d) return null;
  if (!('messaging_first_reply' in recente)) return null; // ainda não coletado: não dá para afirmar
  const respondidas = recente.messaging_first_reply ?? 0;
  const taxa = respondidas / conversas;
  if (taxa >= LIMIARES.respostaTaxaMinima) return null;
  return {
    tipo: 'conversas_sem_resposta',
    severidade: taxa < LIMIARES.respostaTaxaAlta ? 'alta' : 'media',
    desperdicioDia: n2(((recente.spend ?? 0) / 7) * (1 - taxa)),
    frase: `de ${conversas} conversas em 7 dias, só ${respondidas} foram respondidas (${pct(taxa)}): o anúncio entrega e o atendimento não`,
    evidencia: { conversas7d: conversas, respondidas7d: respondidas, taxaResposta: n2(taxa), gasto7d: n2(recente.spend ?? 0) },
  };
}

/** Otimiza para compras, gasta, e nunca registra uma: rastreamento provavelmente ausente. */
export function rastreamentoAusente({ trintaDias, resultado }) {
  if (resultado.origem !== 'meta' || resultado.metrica !== 'conversions') return null;
  const gasto = trintaDias.spend ?? 0;
  if (gasto < LIMIARES.rastreamentoMinGasto30d) return null;
  if ((trintaDias.conversions ?? 0) > 0) return null;
  return {
    tipo: 'rastreamento_ausente',
    severidade: 'alta',
    desperdicioDia: null,
    frase: `otimiza para conversão no site, gastou ${reais(gasto)} em 30 dias e não registrou nenhuma compra: ou o evento otimizado não é compra, ou o rastreamento falhou`,
    evidencia: { gasto30d: n2(gasto), compras30d: 0 },
  };
}

/** Mexeu demais: cada alteração de orçamento, público ou status reinicia o aprendizado. */
export function edicaoExcessiva({ alteracoes7d }) {
  if (!alteracoes7d || alteracoes7d.length < LIMIARES.edicoesMax7d) return null;
  const porCategoria = {};
  for (const a of alteracoes7d) porCategoria[a.categoria] = (porCategoria[a.categoria] ?? 0) + 1;
  const detalhe = Object.entries(porCategoria).map(([c, n]) => `${c} ${n}`).join(', ');
  return {
    tipo: 'edicao_excessiva',
    severidade: alteracoes7d.length >= LIMIARES.edicoesMax7d * 2 ? 'alta' : 'media',
    desperdicioDia: null,
    frase: `${alteracoes7d.length} alterações em 7 dias (${detalhe}): cada uma reinicia o aprendizado da entrega`,
    evidencia: { alteracoes7d: alteracoes7d.length, porCategoria },
  };
}

/**
 * Ritmo do mês contra o investimento planejado. Projeta o fim do mês pela
 * média dos últimos 7 dias.
 */
export function ritmoPlanejado({ gastoMes, mediaDiaria7d, diaDoMes, diasNoMes, planejado }) {
  if (!(planejado > 0) || diaDoMes < 3) return null;
  if (!(mediaDiaria7d > 0) && !(gastoMes > 0)) return null; // conta parada: outro problema, outro sinal
  const diasRestantes = Math.max(0, diasNoMes - diaDoMes);
  const projecao = gastoMes + mediaDiaria7d * diasRestantes;
  const desvio = projecao / planejado - 1;
  if (Math.abs(desvio) < LIMIARES.ritmoDesvio) return null;
  const acima = desvio > 0;
  return {
    tipo: acima ? 'ritmo_acima_do_planejado' : 'ritmo_abaixo_do_planejado',
    severidade: Math.abs(desvio) >= LIMIARES.ritmoDesvioAlta ? 'alta' : 'media',
    desperdicioDia: null, // excesso/dia fica na evidência; não é desperdício por si

    frase: acima
      ? `no ritmo atual fecha o mês em ${reais(projecao)}, ${pct(desvio)} acima dos ${reais(planejado)} planejados`
      : `no ritmo atual fecha o mês em ${reais(projecao)}, ${pct(-desvio)} abaixo dos ${reais(planejado)} planejados`,
    evidencia: { gastoMes: n2(gastoMes), mediaDiaria7d: n2(mediaDiaria7d), diasRestantes, projecao: n2(projecao), planejado: n2(planejado), desvio: n2(desvio), excessoDia: acima && diasRestantes > 0 ? n2((projecao - planejado) / diasRestantes) : null },
  };
}

/**
 * Categoria de cada tipo de sinal. Só `desperdicio` entra na soma de "R$/dia
 * vazando": gastar acima do planejado é risco financeiro, não desperdício —
 * pode estar vendendo bem.
 */
export const CATEGORIA_SINAL = {
  gasto_sem_resultado: 'desperdicio',
  custo_resultado_subindo: 'desperdicio',
  fadiga_criativo: 'desperdicio',
  conversas_sem_resposta: 'desperdicio',
  rastreamento_ausente: 'risco',
  edicao_excessiva: 'operacao',
  ritmo_acima_do_planejado: 'orcamento',
  ritmo_abaixo_do_planejado: 'orcamento',
};

/** Regras por nível de entidade. */
export const REGRAS_ENTIDADE = {
  adset: [gastoSemResultado, custoResultadoSubindo, fadigaCriativo, conversasSemResposta, rastreamentoAusente, edicaoExcessiva],
  ad: [gastoSemResultado],
  campaign: [],
};
