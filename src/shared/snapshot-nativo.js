/**
 * Leitura dos agregados nativos da Meta (janelas 168h, 720h, 744h e a do ciclo).
 *
 * Esses agregados são gravados 1×/dia, uma linha por entidade. Uma campanha que
 * PARA de veicular deixa de receber linha nova — e a última fica no banco para
 * sempre. Pegar "a linha mais recente de cada entidade" sem mais nenhum critério
 * soma o que uma campanha gastou numa janela de julho ao que as ativas gastaram
 * na janela de hoje.
 *
 * Medido em 17/09/2026: 545 das 758 campanhas tinham snapshot de 7 dias parado,
 * respondendo por R$ 3.305 de R$ 26.863 — 12% do "gasto dos últimos 7 dias" do
 * portfólio vinha de campanhas que não veiculavam mais.
 *
 * A solução é ancorar na coleta mais recente daquela janela e aceitar só o que
 * está perto dela. Usar a última coleta como referência, em vez de `now()`, faz
 * o critério continuar coerente quando a coleta inteira atrasa ou para: todas as
 * linhas envelhecem juntas e nenhuma é descartada sem motivo.
 */

/** Tolerância entre a coleta de uma entidade e a coleta mais recente da janela. */
export const TOLERANCIA_SNAPSHOT = '48 hours';

/**
 * Cláusula que restringe a leitura aos snapshots vigentes da janela.
 *
 * Devolve SQL para ser interpolado dentro da consulta — `$${n}` é o índice do
 * parâmetro que carrega `janela_horas`, já presente na consulta chamadora.
 *
 * @param {number} indiceParamJanela - posição de janela_horas na lista de params
 * @param {string} [alias] - prefixo da coluna, quando a consulta usa alias
 */
export function filtroSnapshotVigente(indiceParamJanela, alias = '') {
  const col = alias ? `${alias}.coletada_em` : 'coletada_em';
  return `${col} > (
    SELECT MAX(coletada_em) - INTERVAL '${TOLERANCIA_SNAPSHOT}'
    FROM metricas_serie_temporal
    WHERE janela_horas = $${indiceParamJanela}
  )`;
}
