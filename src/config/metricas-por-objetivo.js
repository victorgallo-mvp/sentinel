/**
 * Métricas prioritárias por objetivo de campanha Meta Ads.
 * Usadas pelo dashboard e relatório diário quando a entidade não tem
 * `metricasPrioritarias` configurado manualmente.
 */

export const METRICAS_POR_OBJETIVO = {
  // Vendas / conversões
  OUTCOME_SALES:      ['spend', 'purchase_roas', 'conversions', 'cost_per_conversion', 'ctr', 'cpm', 'impressions'],
  OUTCOME_LEADS:      ['spend', 'conversions', 'cost_per_conversion', 'ctr', 'cpm', 'reach', 'impressions'],
  // Tráfego
  OUTCOME_TRAFFIC:    ['spend', 'clicks', 'ctr', 'cpc', 'cpm', 'impressions', 'reach'],
  // Awareness / alcance
  OUTCOME_AWARENESS:  ['spend', 'impressions', 'reach', 'frequency', 'cpm'],
  OUTCOME_REACH:      ['spend', 'impressions', 'reach', 'frequency', 'cpm'],
  // Engajamento
  OUTCOME_ENGAGEMENT: ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpm'],
  // Vídeo
  VIDEO_VIEWS:        ['spend', 'impressions', 'video_p25_watched_actions', 'video_p50_watched_actions', 'video_p75_watched_actions', 'video_p100_watched_actions', 'cpm'],
  // App
  OUTCOME_APP_PROMOTION: ['spend', 'conversions', 'cost_per_conversion', 'ctr', 'cpm', 'impressions'],
};

/** Fallback quando objetivo não é reconhecido. */
const METRICAS_PADRAO = ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpm', 'conversions', 'cost_per_conversion', 'purchase_roas'];

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
