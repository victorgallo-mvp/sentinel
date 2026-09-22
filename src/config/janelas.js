/**
 * Valores de `janela_horas` usados em `metricas_serie_temporal`.
 * Cada um é uma semântica diferente — ver a referência de métricas.
 */
export const JANELA_1H_HORAS  = 1;    // última hora
export const JANELA_6H_HORAS  = 6;    // agregado de 6 horas
export const JANELA_DIA_HORAS = 24;   // acumulado do dia (cumulativo entre coletas)
export const JANELA_7D_HORAS  = 168;  // agregado nativo de 7 dias
export const JANELA_30D_HORAS = 720;  // agregado nativo de 30 dias
export const JANELA_MES_HORAS = 744;  // mês-calendário (this_month)
