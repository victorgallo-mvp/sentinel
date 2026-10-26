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

/** Adição ao carrinho, agregada entre web/app/loja (mesma lógica do omni_purchase). */
export const EVENTO_CARRINHO = 'omni_add_to_cart';

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

  // Cliques no LINK. O Gerenciador chama isso de "cliques no link" e usa como
  // padrão em CTR/CPC — `clicks` inclui qualquer clique no anúncio (foto,
  // comentário, perfil), por isso os dois conjuntos nunca batem.
  push('inline_link_clicks', linha.inline_link_clicks);
  push('inline_link_click_ctr', linha.inline_link_click_ctr);
  push('cost_per_inline_link_click', linha.cost_per_inline_link_click);
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

  // Carrinho: etapa intermediária do funil de e-commerce, entre visita e compra.
  const carrinhos = extrairValorAction(linha.actions, EVENTO_CARRINHO);
  push('add_to_cart', carrinhos);
  push('add_to_cart_value', extrairValorAction(linha.action_values, EVENTO_CARRINHO));
  if (carrinhos > 0) push('cost_per_add_to_cart', gasto / carrinhos);

  const receitaOmni = extrairValorAction(linha.action_values, eventoConversao);
  const receitaWebsite = extrairValorAction(linha.action_values, EVENTO_CONVERSAO_WEBSITE);

  // Receita (valor da compra) como componente — permite recompor o ROAS multi-dia
  // corretamente (Σreceita/Σgasto), em vez de mediar as ROAS diárias (que infla com
  // dias de gasto baixo + uma venda: ex.: R$278 ÷ R$0,52 = 535x).
  if (receitaOmni > 0) push('purchase_revenue', receitaOmni);
  if (receitaWebsite > 0) push('website_purchase_revenue', receitaWebsite);

  if (gasto > 0 && receitaOmni > 0) {
    push('purchase_roas', receitaOmni / gasto);
  }
  if (gasto > 0 && receitaWebsite > 0) {
    push('website_purchase_roas', receitaWebsite / gasto);
  }

  push('video_p25_watched_actions',     extrairValorAction(linha.video_p25_watched_actions,     'video_view'));
  push('video_p50_watched_actions',     extrairValorAction(linha.video_p50_watched_actions,     'video_view'));
  push('video_p75_watched_actions',     extrairValorAction(linha.video_p75_watched_actions,     'video_view'));
  push('video_p100_watched_actions',    extrairValorAction(linha.video_p100_watched_actions,    'video_view'));
  // ThruPlay: assistiu ≥15s ou ≥97% do vídeo — campo correto para campanhas THRUPLAY
  push('video_thruplay_watched_actions', extrairValorAction(linha.video_thruplay_watched_actions, 'video_view'));

  // Rankings são enums — não vão pra série temporal (coluna NUMERIC), mas
  // ficam disponíveis pro agente via tools.
  if (linha.quality_ranking) push('quality_ranking', linha.quality_ranking, false);
  if (linha.engagement_rate_ranking) push('engagement_rate_ranking', linha.engagement_rate_ranking, false);
  if (linha.conversion_rate_ranking) push('conversion_rate_ranking', linha.conversion_rate_ranking, false);

  return resultado;
}
