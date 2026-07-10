/**
 * Catálogo de métricas monitoradas — baseado nos campos de "insights" da
 * Meta Marketing API (https://developers.facebook.com/docs/marketing-api/insights).
 *
 * Cada entrada documenta:
 * - nome: rótulo legível em PT-BR
 * - tipo: 'counter' (cresce monotonicamente no período) | 'gauge' (varia livremente) | 'enum'
 * - unidade: 'integer' | 'decimal' | 'percent' | 'currency' | 'multiplier' | 'enum'
 * - direcaoBoa: 'maior' | 'menor' | 'estavel' | 'monitorar' | 'melhor_categoria'
 *     usada pelo agente pra entender se um desvio é bom ou mau sinal
 * - nivel: em quais níveis de entidade essa métrica existe
 * - relevancia: 'critica' | 'alta' | 'media' — prioridade pra detecção de anomalia
 * - thresholdConsideravel (opcional): valor de referência pra "zona de alerta"
 * - campoApi (opcional): nome do campo na Meta API, se diferente da chave
 */

export const CATALOGO_METRICAS = {
  // ===== Métricas de entrega =====
  impressions: {
    nome: 'Impressões',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'monitorar',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'alta',
  },

  reach: {
    nome: 'Alcance',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'monitorar',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'alta',
  },

  frequency: {
    nome: 'Frequência',
    tipo: 'gauge',
    unidade: 'decimal',
    direcaoBoa: 'estavel', // alerta tanto em aumento quanto em queda
    nivel: ['campaign', 'adset'],
    relevancia: 'critica',
    thresholdConsideravel: 4.0, // acima disso indica possível saturação de audiência
  },

  // ===== Métricas de engajamento =====
  clicks: {
    nome: 'Cliques',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  unique_clicks: {
    nome: 'Cliques únicos',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  ctr: {
    nome: 'CTR',
    tipo: 'gauge',
    unidade: 'percent',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
  },

  unique_ctr: {
    nome: 'CTR único',
    tipo: 'gauge',
    unidade: 'percent',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'alta',
  },

  // ===== Métricas de custo =====
  spend: {
    nome: 'Gasto',
    tipo: 'counter',
    unidade: 'currency',
    direcaoBoa: 'monitorar',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
  },

  cpc: {
    nome: 'CPC',
    tipo: 'gauge',
    unidade: 'currency',
    direcaoBoa: 'menor',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'alta',
  },

  cpm: {
    nome: 'CPM',
    tipo: 'gauge',
    unidade: 'currency',
    direcaoBoa: 'menor',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
  },

  cpp: {
    nome: 'CPP (custo por 1000 pessoas alcançadas)',
    tipo: 'gauge',
    unidade: 'currency',
    direcaoBoa: 'menor',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  // ===== Métricas de conversão =====
  conversions: {
    nome: 'Conversões',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
    campoApi: 'actions', // extraído de `actions` filtrando pelo evento de conversão configurado
  },

  leads: {
    nome: 'Leads',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
    campoApi: 'actions', // extraído de `actions`: lead / onsite_conversion.lead_grouped
  },

  messaging_conversations_started: {
    nome: 'Conversas por mensagem iniciada',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'alta',
    campoApi: 'actions', // onsite_conversion.messaging_conversation_started_7d
  },

  conversion_rate: {
    nome: 'Taxa de conversão',
    tipo: 'gauge',
    unidade: 'percent',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
  },

  cost_per_conversion: {
    nome: 'Custo por conversão',
    tipo: 'gauge',
    unidade: 'currency',
    direcaoBoa: 'menor',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
    campoApi: 'cost_per_action_type',
  },

  cost_per_result: {
    nome: 'Custo por resultado',
    tipo: 'gauge',
    unidade: 'currency',
    direcaoBoa: 'menor',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
    // Derivada no dashboard: gasto ÷ resultado (o "resultado" depende do
    // objetivo da campanha — ver metricaResultado). Não é coletada da Meta.
    derivada: true,
  },

  // ===== Métricas de retorno =====
  purchase_roas: {
    nome: 'ROAS de compra',
    tipo: 'gauge',
    unidade: 'multiplier',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
  },

  website_purchase_roas: {
    nome: 'ROAS de compra (site)',
    tipo: 'gauge',
    unidade: 'multiplier',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'critica',
  },

  // ===== Vídeo =====
  video_p25_watched_actions: {
    nome: 'Vídeo assistido 25%',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  video_p50_watched_actions: {
    nome: 'Vídeo assistido 50%',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  video_p75_watched_actions: {
    nome: 'Vídeo assistido 75%',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  video_p100_watched_actions: {
    nome: 'Vídeo assistido 100%',
    tipo: 'counter',
    unidade: 'integer',
    direcaoBoa: 'maior',
    nivel: ['campaign', 'adset', 'ad'],
    relevancia: 'media',
  },

  // ===== Qualidade (rankings) =====
  quality_ranking: {
    nome: 'Quality Ranking',
    tipo: 'enum',
    unidade: 'enum',
    valores: ['above_average', 'average', 'below_average_35', 'below_average_20', 'below_average_10'],
    direcaoBoa: 'melhor_categoria',
    nivel: ['ad'],
    relevancia: 'alta',
  },

  engagement_rate_ranking: {
    nome: 'Engagement Rate Ranking',
    tipo: 'enum',
    unidade: 'enum',
    valores: ['above_average', 'average', 'below_average_35', 'below_average_20', 'below_average_10'],
    direcaoBoa: 'melhor_categoria',
    nivel: ['ad'],
    relevancia: 'media',
  },

  conversion_rate_ranking: {
    nome: 'Conversion Rate Ranking',
    tipo: 'enum',
    unidade: 'enum',
    valores: ['above_average', 'average', 'below_average_35', 'below_average_20', 'below_average_10'],
    direcaoBoa: 'melhor_categoria',
    nivel: ['ad'],
    relevancia: 'media',
  },
};

/** Retorna as chaves de métricas aplicáveis a um nível (campaign/adset/ad). */
export function metricasPorNivel(nivel) {
  return Object.keys(CATALOGO_METRICAS).filter((chave) =>
    CATALOGO_METRICAS[chave].nivel.includes(nivel)
  );
}

/**
 * Retorna as métricas numéricas COLETÁVEIS (exclui rankings 'enum' e métricas
 * derivadas, que são calculadas no dashboard e não existem na série temporal).
 * Usada por coleta e cálculo de baseline.
 */
export function metricasNumericas() {
  return Object.keys(CATALOGO_METRICAS).filter(
    (chave) => CATALOGO_METRICAS[chave].tipo !== 'enum' && !CATALOGO_METRICAS[chave].derivada
  );
}

/**
 * Métrica de "resultado" (contagem) correspondente a cada objetivo de campanha,
 * usada para derivar o custo por resultado (gasto ÷ resultado).
 */
const RESULTADO_POR_OBJETIVO = {
  OUTCOME_SALES:         'conversions',
  OUTCOME_LEADS:         'leads',
  OUTCOME_APP_PROMOTION: 'conversions',
  OUTCOME_ENGAGEMENT:    'messaging_conversations_started',
  OUTCOME_TRAFFIC:       'clicks',
  OUTCOME_AWARENESS:     'reach',
  OUTCOME_REACH:         'reach',
  VIDEO_VIEWS:           'video_p25_watched_actions',
};

/** Chave da métrica de resultado para um objetivo (fallback: conversões). */
export function metricaResultado(objetivo) {
  return RESULTADO_POR_OBJETIVO[String(objetivo || '').toUpperCase()] ?? 'conversions';
}

/**
 * Indica se a métrica é acumulativa (counter — ex.: gasto, impressões, cliques,
 * conversões). Counters crescem ao longo do período, então o valor de uma janela
 * curta (1h/6h) é gasto/volume "por hora", volátil e pouco acionável. Para
 * detecção de anomalia, counters só fazem sentido na janela diária (24h).
 * Gauges (CTR, CPM, ROAS…) são taxas e valem em qualquer janela.
 */
export function metricaAcumulativa(chave) {
  return CATALOGO_METRICAS[chave]?.tipo === 'counter';
}

/** Retorna metadados de uma métrica específica. */
export function obterMetadadosMetrica(chave) {
  return CATALOGO_METRICAS[chave] ?? null;
}

/** Lista as métricas de relevância 'critica', usadas pra priorização. */
export function metricasCriticas() {
  return Object.keys(CATALOGO_METRICAS).filter((chave) => CATALOGO_METRICAS[chave].relevancia === 'critica');
}
