/**
 * Thresholds (sensibilidade) padrão para detecção de anomalias.
 * Valores representam quantos desvios padrão de distância do baseline
 * disparam uma anomalia. Podem ser sobrescritos por conta ou por entidade.
 */

/** Sensibilidade padrão geral (desvios padrão) */
export const SENSIBILIDADE_PADRAO = 2.5;

/**
 * Sensibilidade por métrica — métricas mais "ruidosas" (CTR, frequência em
 * contas pequenas) recebem threshold maior pra evitar falso positivo.
 */
export const SENSIBILIDADE_POR_METRICA = {
  spend: 2.5,
  cpm: 2.5,
  cpc: 2.5,
  ctr: 3.0,
  unique_ctr: 3.0,
  purchase_roas: 2.5,
  website_purchase_roas: 2.5,
  cost_per_conversion: 2.5,
  conversion_rate: 3.0,
  frequency: 2.0,
  reach: 3.0,
  impressions: 3.0,
};

/**
 * Número mínimo de observações históricas para considerar um baseline
 * confiável. Abaixo disso, a métrica é ignorada na detecção.
 */
export const MINIMO_OBSERVACOES_BASELINE = 10;

/**
 * Janela mínima (em horas) entre duas detecções de anomalia para a mesma
 * combinação entidade+métrica+janela — evita re-detecção em loop.
 */
export const JANELA_DEDUPLICACAO_HORAS = 1;

/** Dias de histórico padrão usados pra calcular baseline. */
export const DIAS_HISTORICO_BASELINE_PADRAO = 21;

export function obterSensibilidadeMetrica(metrica) {
  return SENSIBILIDADE_POR_METRICA[metrica] ?? SENSIBILIDADE_PADRAO;
}
