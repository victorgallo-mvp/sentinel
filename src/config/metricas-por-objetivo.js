/**
 * Métricas prioritárias por objetivo de campanha Meta Ads.
 * Usadas pelo dashboard e relatório diário quando a entidade não tem
 * `metricasPrioritarias` configurado manualmente.
 */

export const METRICAS_POR_OBJETIVO = {
  // Vendas / conversões
  OUTCOME_SALES:      ['spend', 'cost_per_result', 'purchase_roas', 'conversions', 'cost_per_conversion', 'ctr', 'cpm', 'impressions'],
  OUTCOME_LEADS:      ['spend', 'cost_per_result', 'conversions', 'cost_per_conversion', 'ctr', 'cpm', 'reach', 'impressions'],
  // Tráfego
  OUTCOME_TRAFFIC:    ['spend', 'cost_per_result', 'clicks', 'ctr', 'cpc', 'cpm', 'impressions', 'reach'],
  // Awareness / alcance
  OUTCOME_AWARENESS:  ['spend', 'cost_per_result', 'impressions', 'reach', 'frequency', 'cpm'],
  OUTCOME_REACH:      ['spend', 'cost_per_result', 'impressions', 'reach', 'frequency', 'cpm'],
  // Engajamento / mensagens
  OUTCOME_ENGAGEMENT: ['spend', 'cost_per_result', 'messaging_conversations_started', 'impressions', 'reach', 'clicks', 'ctr', 'cpm'],
  // Vídeo
  VIDEO_VIEWS:        ['spend', 'cost_per_result', 'impressions', 'video_p25_watched_actions', 'video_p50_watched_actions', 'video_p75_watched_actions', 'video_p100_watched_actions', 'cpm'],
  // App
  OUTCOME_APP_PROMOTION: ['spend', 'cost_per_result', 'conversions', 'cost_per_conversion', 'ctr', 'cpm', 'impressions'],
};

/** Fallback quando objetivo não é reconhecido. */
const METRICAS_PADRAO = ['spend', 'cost_per_result', 'impressions', 'reach', 'clicks', 'ctr', 'cpm', 'conversions', 'cost_per_conversion', 'purchase_roas'];

/**
 * Retorna as métricas a exibir para uma entidade.
 * Prioridade: metricasPrioritarias da entidade > mapeamento por objetivo > fallback.
 */
export function resolverMetricasEntidade(entidade) {
  if (entidade.configuracoes?.metricasPrioritarias?.length > 0) {
    return entidade.configuracoes.metricasPrioritarias;
  }
  const objetivo = entidade.objetivo?.toUpperCase();
  return METRICAS_POR_OBJETIVO[objetivo] ?? METRICAS_PADRAO;
}
