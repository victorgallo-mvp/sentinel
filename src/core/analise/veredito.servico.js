/**
 * Avaliação account-level de melhora/queda ponderada pelos objetivos declarados
 * da conta. Compara os últimos 7 dias com os 7 anteriores, por métrica-resultado
 * de cada objetivo (conversões/mensagens/leads/cliques/alcance), e pondera por
 * prioridade (principal > secundário > terciário). Resolve o "uma campanha caiu,
 * outra subiu → qual o resultado líquido?".
 *
 * Compartilhado entre o dashboard (badge no card) e o resumo diário (texto IA).
 */
import { query } from '../../infra/postgres.js';
import { resolverObjetivosConta } from '../../config/objetivos.config.js';

/**
 * Soma de um resultado (spend, leads, conversions, clicks, reach…) das campanhas
 * num intervalo, pegando o último snapshot de 24h de cada dia por campanha e somando.
 * Obs.: reach é deduplicado e não estritamente aditivo entre dias — para tendência
 * (atual vs anterior somados igual) a direção continua válida.
 */
export async function agregarResultadoPeriodo(campanhaIds, metrica, desde, ate) {
  if (!campanhaIds?.length) return 0;
  const r = await query(
    `SELECT COALESCE(SUM(m.valor), 0)::float AS total
     FROM (
       SELECT entidade_id, date_trunc('day', coletada_em) AS dia, MAX(coletada_em) AS ts
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = $2 AND janela_horas = 24
         AND coletada_em >= $3 AND coletada_em < $4
       GROUP BY entidade_id, date_trunc('day', coletada_em)
     ) d
     JOIN metricas_serie_temporal m
       ON m.entidade_id = d.entidade_id AND m.coletada_em = d.ts
       AND m.metrica = $2 AND m.janela_horas = 24`,
    [campanhaIds, metrica, desde, ate]
  );
  return Number(r.rows[0]?.total ?? 0);
}

/** Gasto do mês corrente (campanhas), somando o último snapshot de 24h de cada dia. */
export async function buscarGastoMes(campanhaIds) {
  const inicioMes = new Date();
  inicioMes.setUTCDate(1);
  inicioMes.setUTCHours(0, 0, 0, 0);
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return agregarResultadoPeriodo(campanhaIds, 'spend', inicioMes, amanha);
}

/**
 * @param {string[]} campanhaIds
 * @param {object} perfil - conta.perfil (com objetivos)
 * @returns {Promise<{direcao, scorePct, detalhes}|null>}
 */
export async function computarVeredito(campanhaIds, perfil) {
  const objetivos = resolverObjetivosConta(perfil);
  if (!objetivos.length || !campanhaIds?.length) return null;

  const fim = new Date();
  const ini = new Date(fim); ini.setDate(ini.getDate() - 7);
  const iniAnt = new Date(ini); iniAnt.setDate(iniAnt.getDate() - 7);

  let somaPonderada = 0;
  let pesoTotal = 0;
  const detalhes = [];
  for (const obj of objetivos) {
    const [atual, anterior] = await Promise.all([
      agregarResultadoPeriodo(campanhaIds, obj.metricaResultado, ini, fim),
      agregarResultadoPeriodo(campanhaIds, obj.metricaResultado, iniAnt, ini),
    ]);
    if (atual <= 0 && anterior <= 0) continue; // sem dados desse objetivo
    const deltaPct = anterior > 0 ? ((atual - anterior) / anterior) * 100 : (atual > 0 ? 100 : 0);
    somaPonderada += deltaPct * obj.peso;
    pesoTotal += obj.peso;
    detalhes.push({ ordem: obj.ordem, chave: obj.chave, rotulo: obj.rotulo, atual, anterior, deltaPct: Number(deltaPct.toFixed(1)) });
  }
  if (pesoTotal === 0) return null;

  const scorePct = somaPonderada / pesoTotal;
  const direcao = scorePct > 5 ? 'melhorou' : scorePct < -5 ? 'piorou' : 'estavel';
  return { direcao, scorePct: Number(scorePct.toFixed(1)), detalhes };
}
