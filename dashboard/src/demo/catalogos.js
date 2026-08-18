// Espelho enxuto do catálogo de métricas do backend (src/config/metricas.config.js),
// só com os campos que o front consome. Mantido separado de propósito: o modo demo
// não pode importar código do backend (bundles separados) nem depender de rede.

export const CATALOGO_METRICAS = {
  impressions:  { nome: 'Impressões',  unidade: 'integer',    direcaoBoa: 'monitorar', nivel: ['campaign', 'adset', 'ad'] },
  reach:        { nome: 'Alcance',     unidade: 'integer',    direcaoBoa: 'monitorar', nivel: ['campaign', 'adset', 'ad'] },
  frequency:    { nome: 'Frequência',  unidade: 'decimal',    direcaoBoa: 'estavel',   nivel: ['campaign', 'adset'] },
  clicks:       { nome: 'Cliques',     unidade: 'integer',    direcaoBoa: 'maior',     nivel: ['campaign', 'adset', 'ad'] },
  unique_clicks:{ nome: 'Cliques únicos', unidade: 'integer', direcaoBoa: 'maior',     nivel: ['campaign', 'adset', 'ad'] },
  ctr:          { nome: 'CTR',         unidade: 'percent',    direcaoBoa: 'maior',     nivel: ['campaign', 'adset', 'ad'] },
  unique_ctr:   { nome: 'CTR único',   unidade: 'percent',    direcaoBoa: 'maior',     nivel: ['campaign', 'adset', 'ad'] },
  spend:        { nome: 'Gasto',       unidade: 'currency',   direcaoBoa: 'monitorar', nivel: ['campaign', 'adset', 'ad'] },
  cpc:          { nome: 'CPC',         unidade: 'currency',   direcaoBoa: 'menor',     nivel: ['campaign', 'adset', 'ad'] },
  cpm:          { nome: 'CPM',         unidade: 'currency',   direcaoBoa: 'menor',     nivel: ['campaign', 'adset', 'ad'] },
  cpp:          { nome: 'CPP (custo por 1000 pessoas alcançadas)', unidade: 'currency', direcaoBoa: 'menor', nivel: ['campaign', 'adset', 'ad'] },
  conversions:  { nome: 'Conversões',  unidade: 'integer',    direcaoBoa: 'maior',     nivel: ['campaign', 'adset', 'ad'] },
  leads:        { nome: 'Leads',       unidade: 'integer',    direcaoBoa: 'maior',     nivel: ['campaign', 'adset', 'ad'] },
  messaging_conversations_started: { nome: 'Conversas por mensagem iniciada', unidade: 'integer', direcaoBoa: 'maior', nivel: ['campaign', 'adset', 'ad'] },
  conversion_rate:     { nome: 'Taxa de conversão',  unidade: 'percent',  direcaoBoa: 'maior', nivel: ['campaign', 'adset', 'ad'] },
  cost_per_conversion: { nome: 'Custo por conversão', unidade: 'currency', direcaoBoa: 'menor', nivel: ['campaign', 'adset', 'ad'] },
  cost_per_result:     { nome: 'Custo por resultado', unidade: 'currency', direcaoBoa: 'menor', nivel: ['campaign', 'adset', 'ad'] },
  purchase_roas:         { nome: 'ROAS de compra',        unidade: 'multiplier', direcaoBoa: 'maior', nivel: ['campaign', 'adset', 'ad'] },
  website_purchase_roas: { nome: 'ROAS de compra (site)', unidade: 'multiplier', direcaoBoa: 'maior', nivel: ['campaign', 'adset', 'ad'] },
};

export function catalogoMetricasResposta() {
  return {
    catalogo: Object.entries(CATALOGO_METRICAS).map(([chave, m]) => ({
      chave, nome: m.nome, unidade: m.unidade, nivel: m.nivel,
    })),
  };
}

// Espelho de METRICAS_ALERTAVEIS_META (dashboard.rota.js) — subconjunto curado
// para metas personalizadas na aba Perfil.
export const METRICAS_ALERTAVEIS_META = [
  { chave: 'purchase_roas',         nome: 'ROAS de compra',       unidade: 'multiplier', operadorPadrao: 'acima_de',  janelas: ['7d', '30d'] },
  { chave: 'website_purchase_roas', nome: 'ROAS de compra (site)', unidade: 'multiplier', operadorPadrao: 'acima_de',  janelas: ['7d', '30d'] },
  { chave: 'ctr',                   nome: 'CTR',                   unidade: 'percent',    operadorPadrao: 'acima_de',  janelas: ['1d', '7d']  },
  { chave: 'cpm',                   nome: 'CPM',                   unidade: 'currency',   operadorPadrao: 'abaixo_de', janelas: ['1d', '7d']  },
  { chave: 'cpc',                   nome: 'CPC',                   unidade: 'currency',   operadorPadrao: 'abaixo_de', janelas: ['1d', '7d']  },
  { chave: 'frequency',             nome: 'Frequência 30d',        unidade: 'decimal',    operadorPadrao: 'abaixo_de', janelas: ['30d']       },
  { chave: 'leads',                 nome: 'Leads',                 unidade: 'integer',    operadorPadrao: 'acima_de',  janelas: ['1d', '7d']  },
  { chave: 'conversions',           nome: 'Conversões',            unidade: 'integer',    operadorPadrao: 'acima_de',  janelas: ['1d', '7d']  },
  { chave: 'messaging_conversations_started', nome: 'Conversas WPP', unidade: 'integer', operadorPadrao: 'acima_de', janelas: ['1d', '7d'] },
];

export function catalogoMetasResposta() {
  return { metricas: METRICAS_ALERTAVEIS_META };
}
