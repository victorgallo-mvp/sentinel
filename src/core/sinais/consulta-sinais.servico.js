/**
 * Leitura dos sinais para o painel. Só SQL e mapeamento; nenhuma regra.
 *
 * O painel mostra a última rodada disponível (normalmente a de hoje, gerada
 * às 04:00 BRT) e uma série curta do desperdício por dia, para dizer se a
 * conta está melhorando ou piorando.
 */
import { query } from '../../infra/postgres.js';

export const ROTULO_TIPO = {
  gasto_sem_resultado: 'Gasto sem resultado',
  custo_resultado_subindo: 'Custo por resultado subindo',
  queda_performance: 'Queda de performance',
  fadiga_criativo: 'Criativo saturado',
  fadiga_iminente: 'Fadiga à vista',
  conversas_sem_resposta: 'Conversas sem resposta',
  rastreamento_ausente: 'Rastreamento ausente',
  edicao_excessiva: 'Edição excessiva',
  realocacao_orcamento: 'Realocar orçamento',
  ritmo_acima_do_planejado: 'Ritmo acima do planejado',
  ritmo_abaixo_do_planejado: 'Ritmo abaixo do planejado',
};

export const ROTULO_CATEGORIA = {
  desperdicio: 'Desperdício',
  previsao: 'Previsão',
  orcamento: 'Orçamento',
  risco: 'Risco',
  operacao: 'Operação',
};

/** Último dia com sinais gerados para qualquer das contas (ou null). */
export async function ultimoDiaSinais(contaIds) {
  if (!contaIds.length) return null;
  const r = await query('SELECT to_char(MAX(gerado_em), \'YYYY-MM-DD\') AS dia FROM sinais_conta WHERE conta_id = ANY($1)', [contaIds]);
  return r.rows[0]?.dia ?? null;
}

/**
 * Sinais de um dia para as contas informadas, do mais grave para o menos.
 * @param {string[]} contaIds - Conta.identificador
 * @param {string} dia - YYYY-MM-DD
 */
export async function listarSinais(contaIds, dia) {
  if (!contaIds.length || !dia) return [];
  const r = await query(
    `SELECT id, conta_id, to_char(gerado_em, 'YYYY-MM-DD') AS gerado_em, tipo, categoria, nivel, entidade_id,
            entidade_nome, conjunto_nome, campanha_nome, metrica_resultado, origem_resultado, severidade,
            desperdicio_dia::float AS desperdicio_dia, frase, explicacao, sugestao, evidencia
     FROM sinais_conta
     WHERE conta_id = ANY($1) AND gerado_em = $2
     ORDER BY CASE severidade WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, desperdicio_dia DESC NULLS LAST, id`,
    [contaIds, dia]
  );
  return r.rows.map(mapearLinha);
}

/**
 * Desperdício somado por conta e dia nos últimos `dias` (só categoria
 * desperdício, como no total do painel), mais a contagem de sinais.
 * @returns {Promise<Array<{contaId: string, dia: string, desperdicioDia: number, sinais: number}>>}
 */
export async function serieDesperdicio(contaIds, dias = 14) {
  if (!contaIds.length) return [];
  const r = await query(
    `SELECT conta_id, to_char(gerado_em, 'YYYY-MM-DD') AS dia,
            COALESCE(SUM(desperdicio_dia) FILTER (WHERE categoria = 'desperdicio'), 0)::float AS desperdicio_dia,
            COUNT(*)::int AS sinais
     FROM sinais_conta
     WHERE conta_id = ANY($1) AND gerado_em >= CURRENT_DATE - ($2 || ' days')::interval
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    [contaIds, String(dias)]
  );
  return r.rows.map((x) => ({ contaId: x.conta_id, dia: x.dia, desperdicioDia: x.desperdicio_dia, sinais: x.sinais }));
}

export function mapearLinha(x) {
  return {
    id: Number(x.id),
    contaId: x.conta_id,
    geradoEm: x.gerado_em,
    tipo: x.tipo,
    tipoRotulo: ROTULO_TIPO[x.tipo] ?? x.tipo,
    categoria: x.categoria,
    nivel: x.nivel,
    entidadeId: x.entidade_id,
    entidadeNome: x.entidade_nome,
    conjuntoNome: x.conjunto_nome,
    campanhaNome: x.campanha_nome,
    metricaResultado: x.metrica_resultado,
    origemResultado: x.origem_resultado,
    severidade: x.severidade,
    desperdicioDia: x.desperdicio_dia,
    economiaDia: x.evidencia?.economiaDia ?? null,
    frase: x.frase,
    explicacao: x.explicacao,
    sugestao: x.sugestao,
    evidencia: x.evidencia ?? {},
  };
}
