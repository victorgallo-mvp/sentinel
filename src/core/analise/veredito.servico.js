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
import { logger } from '../../infra/logger.js';
import { diasComColeta, diasDaJanela, COBERTURA_MINIMA } from './cobertura.js';
import { filtroSnapshotVigente } from '../../shared/snapshot-nativo.js';
import { janelaCicloAtual, JANELA_CICLO_HORAS } from '../../shared/ciclo.js';
import { resolverObjetivosConta } from '../../config/objetivos.config.js';
import { inicioDiaBRT, inicioMesBRT } from '../../shared/utils.js';

/**
 * Soma de um resultado (spend, leads, conversions, clicks, reach…) das campanhas
 * num intervalo, pegando o último snapshot de 24h de cada dia por campanha e somando.
 * Obs.: reach é deduplicado e não estritamente aditivo entre dias — para tendência
 * (atual vs anterior somados igual) a direção continua válida.
 */
/**
 * Compara dois períodos pela MÉDIA DIÁRIA, e não pelo total.
 *
 * Totais só são comparáveis quando os dois períodos têm o mesmo número de dias
 * medidos. Depois de uma parada de coleta isso deixa de valer, e o total do
 * período afetado despenca sem que nada tenha acontecido com as campanhas.
 *
 * @returns {{deltaPct: number, atual: number, anterior: number}|null} null quando
 *   a cobertura de algum dos lados é baixa demais para comparar.
 */
async function compararPeriodos(campanhaIds, metrica, ini, fim, iniAnt) {
  const [atual, anterior, diasAtual, diasAnterior] = await Promise.all([
    agregarResultadoPeriodo(campanhaIds, metrica, ini, fim),
    agregarResultadoPeriodo(campanhaIds, metrica, iniAnt, ini),
    diasComColeta(ini, fim),
    diasComColeta(iniAnt, ini),
  ]);

  if (atual <= 0 && anterior <= 0) return null;

  const esperadoAtual = diasDaJanela(ini, fim);
  const esperadoAnterior = diasDaJanela(iniAnt, ini);
  if (diasAtual / esperadoAtual < COBERTURA_MINIMA || diasAnterior / esperadoAnterior < COBERTURA_MINIMA) {
    logger.warn({
      msg: 'Veredito omitido — coleta insuficiente no período',
      metrica, diasAtual, esperadoAtual, diasAnterior, esperadoAnterior,
    });
    return null;
  }

  const mediaAtual = atual / diasAtual;
  const mediaAnterior = anterior / diasAnterior;
  const deltaPct = mediaAnterior > 0
    ? ((mediaAtual - mediaAnterior) / mediaAnterior) * 100
    : (mediaAtual > 0 ? 100 : 0);

  return { deltaPct, atual, anterior };
}

export async function agregarResultadoPeriodo(campanhaIds, metrica, desde, ate) {
  if (!campanhaIds?.length) return 0;
  const r = await query(
    `SELECT COALESCE(SUM(m.valor), 0)::float AS total
     FROM (
       SELECT entidade_id, date_trunc('day', coletada_em AT TIME ZONE 'America/Sao_Paulo') AS dia, MAX(coletada_em) AS ts
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = $2 AND janela_horas = 24
         AND coletada_em >= $3 AND coletada_em < $4
       GROUP BY entidade_id, date_trunc('day', coletada_em AT TIME ZONE 'America/Sao_Paulo')
     ) d
     JOIN metricas_serie_temporal m
       ON m.entidade_id = d.entidade_id AND m.coletada_em = d.ts
       AND m.metrica = $2 AND m.janela_horas = 24`,
    [campanhaIds, metrica, desde, ate]
  );
  return Number(r.rows[0]?.total ?? 0);
}

/**
 * Gasto do ciclo de faturamento corrente — lê o snapshot nativo coletado 1×/dia
 * direto da Meta. Muito mais preciso do que somar snapshots diários de 24h, que
 * têm drift de UTC vs. fuso do anunciante (~9% a menos no acumulado).
 *
 * Quando o cliente tem ciclo próprio (`diaInicioCiclo` ≠ 1), lê a janela do
 * ciclo (janela_horas=1); senão, o mês-calendário (`this_month`, 744). Cai para
 * a soma diária enquanto a primeira coleta nativa não rodou.
 *
 * @param {string[]} campanhaIds
 * @param {number} [diaInicioCiclo] - 1 = mês-calendário
 */
export async function buscarGastoMes(campanhaIds, diaInicioCiclo = 1) {
  if (!campanhaIds?.length) return 0;

  const usaCiclo = Number(diaInicioCiclo) > 1;
  const janela = usaCiclo ? JANELA_CICLO_HORAS : 744;

  const r = await query(
    `SELECT COALESCE(SUM(s), 0)::float AS total, COUNT(*) AS n FROM (
       SELECT DISTINCT ON (entidade_id) valor AS s
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = $2
         AND ${filtroSnapshotVigente(2)}
       ORDER BY entidade_id, coletada_em DESC
     ) x`,
    [campanhaIds, janela]
  );
  if (Number(r.rows[0]?.n) > 0) return Number(r.rows[0]?.total ?? 0);
  // Fallback: soma diária até a primeira coleta nativa rodar
  const inicio = usaCiclo
    ? new Date(janelaCicloAtual(Number(diaInicioCiclo)).inicio.getTime() + 3 * 60 * 60 * 1000)
    : inicioMesBRT();
  const amanha = new Date(inicioDiaBRT(0).getTime() + 24 * 60 * 60 * 1000);
  return agregarResultadoPeriodo(campanhaIds, 'spend', inicio, amanha);
}

/** Gasto do mês anterior (30 dias antes do início do período de 30d). */
export async function buscarGasto30dAnterior(campanhaIds) {
  if (!campanhaIds?.length) return 0;
  const fim = inicioDiaBRT(30);
  const ini = inicioDiaBRT(60);
  return agregarResultadoPeriodo(campanhaIds, 'spend', ini, fim);
}

/**
 * Compara 30d atual vs. 30d anterior nas métricas-resultado dos objetivos declarados.
 * Mesmo algoritmo que computarVeredito, mas janela de 30 dias (≈tendência de médio prazo).
 * @returns {Promise<{direcao, scorePct, detalhes}|null>}
 */
export async function computarVeredito30d(campanhaIds, perfil) {
  let objetivos = resolverObjetivosConta(perfil);
  if (!campanhaIds?.length) return null;

  const fim    = inicioDiaBRT(0);
  const ini    = inicioDiaBRT(30);
  const iniAnt = inicioDiaBRT(60);

  if (!objetivos.length) {
    for (const candidato of AUTO_DETECT_ORDEM) {
      const total = await agregarResultadoPeriodo(campanhaIds, candidato.metricaResultado, ini, fim);
      if (total > 0) {
        objetivos = [{ ordem: 1, chave: 'auto', ...candidato, peso: 1 }];
        break;
      }
    }
    if (!objetivos.length) return null;
  }

  let somaPonderada = 0;
  let pesoTotal = 0;
  const detalhes = [];
  for (const obj of objetivos) {
    const comp = await compararPeriodos(campanhaIds, obj.metricaResultado, ini, fim, iniAnt);
    if (!comp) continue;
    const { deltaPct, atual, anterior } = comp;
    somaPonderada += deltaPct * obj.peso;
    pesoTotal += obj.peso;
    detalhes.push({ ordem: obj.ordem, chave: obj.chave, rotulo: obj.rotulo, valor30d: atual, valor30dAnterior: anterior, deltaPct: Number(deltaPct.toFixed(1)) });
  }
  if (pesoTotal === 0) return null;

  const scorePct = somaPonderada / pesoTotal;
  const direcao = scorePct > 5 ? 'melhorou' : scorePct < -5 ? 'piorou' : 'estavel';
  return { direcao, scorePct: Number(scorePct.toFixed(1)), detalhes };
}

// Ordem de prioridade para auto-detecção quando não há objetivos declarados.
// A primeira métrica com valor > 0 no período é usada.
const AUTO_DETECT_ORDEM = [
  { metricaResultado: 'messaging_conversations_started', rotulo: 'conversas' },
  { metricaResultado: 'leads',                           rotulo: 'leads' },
  { metricaResultado: 'conversions',                     rotulo: 'conversões' },
  { metricaResultado: 'video_thruplay_watched_actions',  rotulo: 'ThruPlay' },
  { metricaResultado: 'clicks',                          rotulo: 'cliques' },
  { metricaResultado: 'reach',                           rotulo: 'alcance' },
];

/**
 * @param {string[]} campanhaIds
 * @param {object} perfil - conta.perfil (com objetivos)
 * @returns {Promise<{direcao, scorePct, detalhes}|null>}
 */
export async function computarVeredito(campanhaIds, perfil) {
  let objetivos = resolverObjetivosConta(perfil);
  if (!campanhaIds?.length) return null;

  const fim    = inicioDiaBRT(0);
  const ini    = inicioDiaBRT(7);
  const iniAnt = inicioDiaBRT(14);

  // Auto-detecção: conta sem objetivos configurados — usa a primeira métrica
  // com dados reais no período recente para não retornar null sem necessidade.
  if (!objetivos.length) {
    for (const candidato of AUTO_DETECT_ORDEM) {
      const total = await agregarResultadoPeriodo(campanhaIds, candidato.metricaResultado, ini, fim);
      if (total > 0) {
        objetivos = [{ ordem: 1, chave: 'auto', ...candidato, peso: 1 }];
        break;
      }
    }
    if (!objetivos.length) return null;
  }

  let somaPonderada = 0;
  let pesoTotal = 0;
  const detalhes = [];
  for (const obj of objetivos) {
    const comp = await compararPeriodos(campanhaIds, obj.metricaResultado, ini, fim, iniAnt);
    if (!comp) continue; // sem dados do objetivo, ou coleta insuficiente para comparar
    const { deltaPct, atual, anterior } = comp;
    somaPonderada += deltaPct * obj.peso;
    pesoTotal += obj.peso;
    // valor7d / valor7dAnterior: nomes explícitos para o texto da IA não confundir com "ontem"
    detalhes.push({ ordem: obj.ordem, chave: obj.chave, rotulo: obj.rotulo, valor7d: atual, valor7dAnterior: anterior, deltaPct: Number(deltaPct.toFixed(1)) });
  }
  if (pesoTotal === 0) return null;

  const scorePct = somaPonderada / pesoTotal;
  const direcao = scorePct > 5 ? 'melhorou' : scorePct < -5 ? 'piorou' : 'estavel';
  return { direcao, scorePct: Number(scorePct.toFixed(1)), detalhes };
}
