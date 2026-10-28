/**
 * Leitura das séries que o motor de sinais consome. Só SQL; nenhuma regra.
 *
 * A série diária é o último snapshot de 24h de cada dia BRT — com a coleta
 * diária, é a linha de fechamento às 23:59. Métricas ausentes num dia ficam
 * ausentes (não viram zero): o motor precisa distinguir "não coletado" de
 * "aconteceu zero", senão acusa falta de resposta onde só faltou coleta.
 */
import { query } from '../../infra/postgres.js';
import { JANELA_7D_HORAS } from '../../config/janelas.js';
import { filtroSnapshotVigente } from '../../shared/snapshot-nativo.js';

/** Métricas que as regras usam. */
export const METRICAS_SERIE = [
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks',
  'conversions', 'purchase_revenue', 'leads',
  'messaging_conversations_started', 'messaging_first_reply',
  'landing_page_views', 'video_thruplay_watched_actions',
];

/**
 * Série diária por entidade no intervalo [desde, ate) (instantes UTC).
 * @returns {Promise<Map<string, Array<{dia: string} & Record<string, number>>>>}
 */
export async function carregarSerieDiaria(entidadeIds, desde, ate) {
  const mapa = new Map();
  if (!entidadeIds.length) return mapa;
  const r = await query(
    `WITH ultimas AS (
       SELECT entidade_id, (coletada_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, MAX(coletada_em) AS ts
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND janela_horas = 24 AND coletada_em >= $2 AND coletada_em < $3
       GROUP BY 1, 2
     )
     SELECT u.entidade_id, to_char(u.dia, 'YYYY-MM-DD') AS dia, m.metrica, m.valor::float AS valor
     FROM ultimas u
     JOIN metricas_serie_temporal m
       ON m.entidade_id = u.entidade_id AND m.coletada_em = u.ts AND m.janela_horas = 24
     WHERE m.metrica = ANY($4)
     ORDER BY u.entidade_id, u.dia`,
    [entidadeIds, desde, ate, METRICAS_SERIE]
  );
  for (const row of r.rows) {
    if (!mapa.has(row.entidade_id)) mapa.set(row.entidade_id, new Map());
    const dias = mapa.get(row.entidade_id);
    if (!dias.has(row.dia)) dias.set(row.dia, { dia: row.dia });
    dias.get(row.dia)[row.metrica] = row.valor;
  }
  return new Map([...mapa.entries()].map(([id, dias]) => [id, [...dias.values()]]));
}

/**
 * Frequência e alcance dos últimos 7 dias, do agregado nativo da Meta (a
 * frequência não se reconstrói somando dias).
 * @returns {Promise<Map<string, {frequency: number|null, reach: number|null}>>}
 */
export async function carregarFrequencia7d(entidadeIds) {
  const mapa = new Map();
  if (!entidadeIds.length) return mapa;
  const r = await query(
    `SELECT DISTINCT ON (entidade_id, metrica) entidade_id, metrica, valor::float AS valor
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND janela_horas = $2 AND metrica IN ('frequency', 'reach')
       AND ${filtroSnapshotVigente(2)}
     ORDER BY entidade_id, metrica, coletada_em DESC`,
    [entidadeIds, JANELA_7D_HORAS]
  );
  for (const row of r.rows) {
    if (!mapa.has(row.entidade_id)) mapa.set(row.entidade_id, { frequency: null, reach: null });
    mapa.get(row.entidade_id)[row.metrica] = row.valor;
  }
  return mapa;
}

/**
 * Histórico da frequência de 7 dias: um ponto por dia (último snapshot da
 * janela 168h de cada dia BRT), nos últimos `dias`. É o que permite dizer se a
 * frequência está subindo e em quanto tempo cruza o limite de fadiga.
 * @returns {Promise<Map<string, Array<{dia: string, frequency: number}>>>}
 */
export async function carregarFrequenciaHistorico(entidadeIds, dias = 8) {
  const mapa = new Map();
  if (!entidadeIds.length) return mapa;
  const r = await query(
    `SELECT DISTINCT ON (entidade_id, dia) entidade_id,
            to_char((coletada_em AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia,
            valor::float AS frequency
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND janela_horas = $2 AND metrica = 'frequency'
       AND coletada_em >= now() - ($3 || ' days')::interval
     ORDER BY entidade_id, dia, coletada_em DESC`,
    [entidadeIds, JANELA_7D_HORAS, String(dias)]
  );
  for (const row of r.rows) {
    if (!mapa.has(row.entidade_id)) mapa.set(row.entidade_id, []);
    mapa.get(row.entidade_id).push({ dia: row.dia, frequency: row.frequency });
  }
  for (const lista of mapa.values()) lista.sort((a, b) => (a.dia < b.dia ? -1 : 1));
  return mapa;
}

/**
 * Alterações humanas recentes por objeto da Meta (id do conjunto/anúncio),
 * só as categorias que reiniciam o aprendizado da entrega.
 * @returns {Promise<Map<string, Array<{categoria: string, ocorridaEm: Date}>>>}
 */
export async function carregarAlteracoesRecentes(contaIdentificador, desde) {
  const r = await query(
    `SELECT objeto_id, categoria, ocorrida_em
     FROM alteracoes_conta
     WHERE conta_id = $1 AND ocorrida_em >= $2 AND sistema = false AND oculto = false
       AND categoria IN ('orcamento', 'segmentacao', 'status', 'criativo')`,
    [contaIdentificador, desde]
  );
  const mapa = new Map();
  for (const row of r.rows) {
    if (!row.objeto_id) continue;
    if (!mapa.has(row.objeto_id)) mapa.set(row.objeto_id, []);
    mapa.get(row.objeto_id).push({ categoria: row.categoria, ocorridaEm: row.ocorrida_em });
  }
  return mapa;
}
