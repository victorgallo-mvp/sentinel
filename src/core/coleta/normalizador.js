/**
 * Normaliza linhas "cruas" de insights da Meta API para o formato
 * `{ metrica, valor }` usado pelo catálogo de métricas (`metricas.config.js`)
 * e persistido em `metricas_serie_temporal`.
 *
 * Conversões, taxa de conversão, custo por conversão e ROAS são sempre
 * RECALCULADOS a partir de `actions`/`action_values`/`spend`/`impressions` —
 * isso garante que a mesma lógica funcione tanto para linhas individuais
 * (vindas direto da Meta) quanto para linhas agregadas (somadas localmente
 * a partir do breakdown horário).
 */

/** Evento de conversão considerado "a conversão principal" da conta. */
export const EVENTO_CONVERSAO_PADRAO = 'omni_purchase';

/** Evento usado especificamente para ROAS de site. */
export const EVENTO_CONVERSAO_WEBSITE = 'offsite_conversion.fb_pixel_purchase';

/** Extrai o valor de um `action_type` específico de uma lista `actions`/`action_values`. */
export function extrairValorAction(lista, tipoAction) {
  if (!Array.isArray(lista)) return 0;
  const item = lista.find((a) => a.action_type === tipoAction);
  return item ? Number(item.value) || 0 : 0;
}

/**
 * Normaliza uma linha de insight (crua ou agregada) em uma lista de
 * `{ metrica, valor, numerica }` prontos para persistência ou uso pelo agente.
 */
export function normalizarLinhaInsight(linha, { eventoConversao = EVENTO_CONVERSAO_PADRAO } = {}) {
  if (!linha) return [];

  const resultado = [];
  const push = (metrica, valor, numerica = true) => {
    if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return;
    resultado.push({ metrica, valor: numerica ? Number(valor) : valor, numerica });
  };

  push('impressions', linha.impressions);
  push('reach', linha.reach);
  push('frequency', linha.frequency);
  push('clicks', linha.clicks);
  push('unique_clicks', linha.unique_clicks);
  push('ctr', linha.ctr);
  push('unique_ctr', linha.unique_ctr);
  push('spend', linha.spend);
  push('cpc', linha.cpc);
  push('cpm', linha.cpm);
  push('cpp', linha.cpp);

  const impressoes = Number(linha.impressions) || 0;
  const gasto = Number(linha.spend) || 0;

  const conversoes = extrairValorAction(linha.actions, eventoConversao);
  push('conversions', conversoes);

  // Conversas iniciadas por mensagem (campanhas de mensagens/WhatsApp)
  push('messaging_conversations_started', extrairValorAction(linha.actions, 'onsite_conversion.messaging_conversation_started_7d'));

  // Leads (campanhas de formulário/lead) — 'lead' agrega; fallback p/ lead_grouped (forms nativos)
  push('leads', Math.max(
    extrairValorAction(linha.actions, 'lead'),
    extrairValorAction(linha.actions, 'onsite_conversion.lead_grouped')
  ));

  if (impressoes > 0) {
    push('conversion_rate', (conversoes / impressoes) * 100);
  }

  if (conversoes > 0) {
    push('cost_per_conversion', gasto / conversoes);
  }

  const receitaOmni = extrairValorAction(linha.action_values, eventoConversao);
  const receitaWebsite = extrairValorAction(linha.action_values, EVENTO_CONVERSAO_WEBSITE);

  if (gasto > 0 && receitaOmni > 0) {
    push('purchase_roas', receitaOmni / gasto);
  }
  if (gasto > 0 && receitaWebsite > 0) {
    push('website_purchase_roas', receitaWebsite / gasto);
  }

  push('video_p25_watched_actions', extrairValorAction(linha.video_p25_watched_actions, 'video_view'));
  push('video_p50_watched_actions', extrairValorAction(linha.video_p50_watched_actions, 'video_view'));
  push('video_p75_watched_actions', extrairValorAction(linha.video_p75_watched_actions, 'video_view'));
  push('video_p100_watched_actions', extrairValorAction(linha.video_p100_watched_actions, 'video_view'));

  // Rankings são enums — não vão pra série temporal (coluna NUMERIC), mas
  // ficam disponíveis pro agente via tools.
  if (linha.quality_ranking) push('quality_ranking', linha.quality_ranking, false);
  if (linha.engagement_rate_ranking) push('engagement_rate_ranking', linha.engagement_rate_ranking, false);
  if (linha.conversion_rate_ranking) push('conversion_rate_ranking', linha.conversion_rate_ranking, false);

  return resultado;
}

/**
 * Agrega múltiplas linhas horárias em uma única linha "crua" equivalente,
 * somando contadores e recompondo `actions`/`action_values` pra que
 * `normalizarLinhaInsight` recalcule as razões (ctr, cpm, roas, etc).
 *
 * Limitação conhecida: `reach` não é estritamente aditivo entre horas
 * (a mesma pessoa pode ser alcançada em horas diferentes), então o
 * `reach` agregado aqui é uma aproximação por excesso.
 */
export function agregarLinhasHorarias(linhas) {
  if (!linhas || linhas.length === 0) return null;

  const acumulado = {
    impressions: 0,
    reach: 0,
    clicks: 0,
    unique_clicks: 0,
    spend: 0,
  };
  const actionsTotais = new Map();
  const actionValuesTotais = new Map();
  const videos = {
    video_p25_watched_actions: 0,
    video_p50_watched_actions: 0,
    video_p75_watched_actions: 0,
    video_p100_watched_actions: 0,
  };

  const somarMapa = (mapa, lista) => {
    for (const item of lista || []) {
      const atual = mapa.get(item.action_type) || 0;
      mapa.set(item.action_type, atual + (Number(item.value) || 0));
    }
  };

  for (const linha of linhas) {
    acumulado.impressions += Number(linha.impressions) || 0;
    acumulado.reach += Number(linha.reach) || 0;
    acumulado.clicks += Number(linha.clicks) || 0;
    acumulado.unique_clicks += Number(linha.unique_clicks) || 0;
    acumulado.spend += Number(linha.spend) || 0;

    somarMapa(actionsTotais, linha.actions);
    somarMapa(actionValuesTotais, linha.action_values);

    for (const campo of Object.keys(videos)) {
      videos[campo] += extrairValorAction(linha[campo], 'video_view');
    }
  }

  const { impressions, reach, clicks, unique_clicks, spend } = acumulado;

  return {
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : 0,
    clicks,
    unique_clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    unique_ctr: reach > 0 ? (unique_clicks / reach) * 100 : 0,
    spend,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpp: reach > 0 ? (spend / reach) * 1000 : 0,
    actions: [...actionsTotais.entries()].map(([action_type, value]) => ({ action_type, value })),
    action_values: [...actionValuesTotais.entries()].map(([action_type, value]) => ({ action_type, value })),
    video_p25_watched_actions: [{ action_type: 'video_view', value: videos.video_p25_watched_actions }],
    video_p50_watched_actions: [{ action_type: 'video_view', value: videos.video_p50_watched_actions }],
    video_p75_watched_actions: [{ action_type: 'video_view', value: videos.video_p75_watched_actions }],
    video_p100_watched_actions: [{ action_type: 'video_view', value: videos.video_p100_watched_actions }],
    // Rankings não fazem sentido agregados — fica o da última hora disponível.
    quality_ranking: linhas[linhas.length - 1]?.quality_ranking ?? null,
    engagement_rate_ranking: linhas[linhas.length - 1]?.engagement_rate_ranking ?? null,
    conversion_rate_ranking: linhas[linhas.length - 1]?.conversion_rate_ranking ?? null,
  };
}
