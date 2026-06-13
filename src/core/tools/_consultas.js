/**
 * Helpers internos de consulta compartilhados entre as tools do agente.
 * Não é uma tool — apenas evita duplicar as mesmas queries SQL em
 * vários arquivos de tool.
 */
import { query } from '../../infra/postgres.js';
import { calcularEstatisticas } from '../../shared/utils.js';

/** Retorna os pontos históricos (valor + data) de uma métrica, mais antigos primeiro. */
export async function obterHistoricoMetrica(entidadeId, metrica, janelaHoras, dias) {
  const resultado = await query(
    `
    SELECT valor, coletada_em FROM metricas_serie_temporal
    WHERE entidade_id = $1 AND metrica = $2 AND janela_horas = $3
      AND coletada_em > NOW() - INTERVAL '1 day' * $4
    ORDER BY coletada_em ASC
    `,
    [entidadeId, metrica, janelaHoras, dias]
  );

  return resultado.rows.map((r) => ({ valor: Number(r.valor), data: r.coletada_em }));
}

/** Retorna o valor mais recente de uma métrica para uma entidade+janela, ou `null`. */
export async function obterValorMaisRecente(entidadeId, metrica, janelaHoras) {
  const resultado = await query(
    `
    SELECT valor, coletada_em FROM metricas_serie_temporal
    WHERE entidade_id = $1 AND metrica = $2 AND janela_horas = $3
    ORDER BY coletada_em DESC
    LIMIT 1
    `,
    [entidadeId, metrica, janelaHoras]
  );

  if (resultado.rows.length === 0) return null;
  return { valor: Number(resultado.rows[0].valor), coletadaEm: resultado.rows[0].coletada_em };
}

/** Retorna o baseline calculado de uma combinação entidade+métrica+janela, ou `null`. */
export async function obterBaseline(entidadeId, metrica, janelaHoras) {
  const resultado = await query(
    `SELECT * FROM baselines WHERE entidade_id = $1 AND metrica = $2 AND janela_horas = $3`,
    [entidadeId, metrica, janelaHoras]
  );

  if (resultado.rows.length === 0) return null;
  const linha = resultado.rows[0];
  return {
    media: Number(linha.media),
    desvioPadrao: Number(linha.desvio_padrao),
    minimo: Number(linha.minimo),
    maximo: Number(linha.maximo),
    quantidadeObservacoes: linha.quantidade_observacoes,
    diasHistorico: linha.dias_historico,
    calculadoEm: linha.calculado_em,
  };
}

/** Calcula estatísticas a partir do histórico de uma métrica. */
export function estatisticasHistorico(pontos) {
  return calcularEstatisticas(pontos.map((p) => p.valor));
}
