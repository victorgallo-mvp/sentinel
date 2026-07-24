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

/**
 * Gasto do mês corrente — lê o snapshot nativo de `this_month` (janela_horas=744)
 * coletado 1×/dia direto da Meta. Muito mais preciso do que somar snapshots diários
 * de 24h, que têm drift de UTC vs. fuso do anunciante (~9% a menos no acumulado).
 * Fallback para soma diária enquanto a primeira coleta de 744h não rodou ainda.
 */
export async function buscarGastoMes(campanhaIds) {
  if (!campanhaIds?.length) return 0;
  const r = await query(
    `SELECT COALESCE(SUM(s), 0)::float AS total, COUNT(*) AS n FROM (
       SELECT DISTINCT ON (entidade_id) valor AS s
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = 744
       ORDER BY entidade_id, coletada_em DESC
     ) x`,
    [campanhaIds]
  );
  if (Number(r.rows[0]?.n) > 0) return Number(r.rows[0]?.total ?? 0);
  // Fallback: soma diária até a primeira coleta nativa rodar
  const inicioMes = new Date();
  inicioMes.setUTCDate(1);
  inicioMes.setUTCHours(0, 0, 0, 0);
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return agregarResultadoPeriodo(campanhaIds, 'spend', inicioMes, amanha);
}

/** Gasto do mês anterior (30 dias antes do início do período de 30d). */
export async function buscarGasto30dAnterior(campanhaIds) {
  if (!campanhaIds?.length) return 0;
  const fim = new Date(); fim.setDate(fim.getDate() - 30);
  const ini = new Date(fim); ini.setDate(ini.getDate() - 30);
  return agregarResultadoPeriodo(campanhaIds, 'spend', ini, fim);
}

/**
 * Compara 30d atual vs. 30d anterior nas métricas-resultado dos objetivos declarados.
 * Mesmo algoritmo que computarVeredito, mas janela de 30 dias (≈tendência de médio prazo).
 * @returns {Promise<{direcao, scorePct, detalhes}|null>}
 */
export async function computarVeredito30d(campanhaIds, perfil) {
  const objetivos = resolverObjetivosConta(perfil);
  if (!objetivos.length || !campanhaIds?.length) return null;

  const fim = new Date();
  const ini = new Date(fim); ini.setDate(ini.getDate() - 30);
  const iniAnt = new Date(ini); iniAnt.setDate(iniAnt.getDate() - 30);

  let somaPonderada = 0;
  let pesoTotal = 0;
  const detalhes = [];
  for (const obj of objetivos) {
    const [atual, anterior] = await Promise.all([
      agregarResultadoPeriodo(campanhaIds, obj.metricaResultado, ini, fim),
      agregarResultadoPeriodo(campanhaIds, obj.metricaResultado, iniAnt, ini),
    ]);
    if (atual <= 0 && anterior <= 0) continue;
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
