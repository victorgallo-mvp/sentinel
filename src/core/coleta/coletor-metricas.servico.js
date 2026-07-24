/**
 * Serviço de coleta de métricas — roda periodicamente (job de coleta) e,
 * para cada entidade monitorada de uma conta, busca insights na Meta API
 * e persiste em `metricas_serie_temporal` (Postgres) nas janelas 1h, 6h e 24h.
 *
 * Falha em uma entidade NÃO interrompe a coleta das demais.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { obterInsights, obterInsightsHorarios } from './meta-api.cliente.js';
import { normalizarLinhaInsight, agregarLinhasHorarias } from './normalizador.js';
import { metricasNumericas } from '../../config/metricas.config.js';
import { query } from '../../infra/postgres.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';
import { arredondarParaIntervalo } from '../../shared/utils.js';

const JANELA_ARREDONDAMENTO_MINUTOS = 5;
const CONJUNTO_METRICAS_NUMERICAS = new Set(metricasNumericas());

// Períodos agregados coletados 1×/dia (agregado real da Meta, uma linha por período).
// 30d é usado pelas métricas deduplicadas (freq/alcance/únicos) e pelo gasto de 30d;
// 7d é usado pelo gasto de 7d no dashboard.
// this_month (janelaHoras=744) é usado para o gasto do mês corrente — mais preciso do
// que somar snapshots diários (que herdam drift de UTC vs. fuso do anunciante).
const PERIODOS_AGREGADOS = [
  { datePreset: 'last_7d',    janelaHoras: 168 },
  { datePreset: 'last_30d',   janelaHoras: 720 },
  { datePreset: 'this_month', janelaHoras: 744 },
];

/**
 * Coleta métricas de todas as entidades monitoradas de uma conta.
 * @param {string} contaId - ObjectId da Conta no MongoDB
 */
export async function coletarMetricasConta(contaId) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);

  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true });
  logger.info({ msg: 'Iniciando coleta de métricas', contaId: String(contaId), totalEntidades: entidades.length });

  const agora = arredondarParaIntervalo(new Date(), JANELA_ARREDONDAMENTO_MINUTOS);
  let sucesso = 0;
  let falhas = 0;

  for (const entidade of entidades) {
    try {
      await coletarMetricasEntidade(conta, entidade, agora);
      sucesso++;
    } catch (erro) {
      falhas++;
      logger.error({
        msg: 'Falha ao coletar métricas de entidade — pulando',
        entidadeId: String(entidade._id),
        metaId: entidade.metaId,
        tipo: entidade.tipo,
        erro: erro.message,
      });
    }
  }

  logger.info({ msg: 'Coleta de métricas concluída', contaId: String(contaId), sucesso, falhas, total: entidades.length });
  return { sucesso, falhas, total: entidades.length };
}

/**
 * Coleta o agregado REAL de um período (`last_Nd`, linha única) de uma entidade e
 * persiste em `metricas_serie_temporal` com a `janelaHoras` do período. A Meta
 * deduplica alcance/frequência entre dias — algo impossível de reconstruir dos
 * snapshots diários. Usado pelas métricas deduplicadas e pelo gasto 7d/30d. Roda 1×/dia.
 */
export async function coletarMetricasPeriodoEntidade(conta, entidade, { datePreset, janelaHoras }, coletadaEm = new Date()) {
  const token = conta.metaConfig?.systemUserToken || undefined;
  const linhas = await obterInsights(entidade.tipo, entidade.metaId, {
    datePreset,
    timeIncrement: 'all_days', // uma única linha agregada do período inteiro
    token,
  });
  if (linhas.length > 0) {
    await persistirMetricas(conta, entidade, normalizarLinhaInsight(linhas[0]), janelaHoras, coletadaEm);
  }
}

/** Coleta os agregados de período (7d e 30d) de todas as entidades monitoradas de uma conta. */
export async function coletarMetricasPeriodosConta(contaId) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);

  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true });
  const agora = arredondarParaIntervalo(new Date(), JANELA_ARREDONDAMENTO_MINUTOS);
  let sucesso = 0;
  let falhas = 0;

  for (const entidade of entidades) {
    for (const periodo of PERIODOS_AGREGADOS) {
      try {
        await coletarMetricasPeriodoEntidade(conta, entidade, periodo, agora);
        sucesso++;
      } catch (erro) {
        falhas++;
        logger.error({ msg: 'Falha ao coletar período de entidade — pulando', entidadeId: String(entidade._id), metaId: entidade.metaId, periodo: periodo.datePreset, erro: erro.message });
      }
    }
  }

  logger.info({ msg: 'Coleta de períodos (7d/30d) concluída', contaId: String(contaId), sucesso, falhas, entidades: entidades.length });
  return { sucesso, falhas, total: entidades.length };
}

/** Coleta e persiste as três janelas (1h, 6h, 24h) de uma única entidade. */
export async function coletarMetricasEntidade(conta, entidade, coletadaEm = new Date()) {
  const token = conta.metaConfig?.systemUserToken || undefined;

  const linhasHorarias = await obterInsightsHorarios(entidade.tipo, entidade.metaId, token);

  // Janela 1h: última linha horária disponível (hora corrente ou anterior)
  if (linhasHorarias.length > 0) {
    const ultimaHora = linhasHorarias[linhasHorarias.length - 1];
    await persistirMetricas(conta, entidade, normalizarLinhaInsight(ultimaHora), 1, coletadaEm);
  }

  // Janela 6h: agrega as últimas 6 linhas horárias
  const ultimas6 = linhasHorarias.slice(-6);
  if (ultimas6.length > 0) {
    const agregado6h = agregarLinhasHorarias(ultimas6);
    await persistirMetricas(conta, entidade, normalizarLinhaInsight(agregado6h), 6, coletadaEm);
  }

  // Janela 24h: agregação correta (com dedup de reach) vem direto da Meta.
  // `last_24h` não existe como date_preset na Graph API — `today` é o
  // equivalente válido mais próximo (acumulado desde 00h no fuso do anunciante).
  const linhas24h = await obterInsights(entidade.tipo, entidade.metaId, { datePreset: 'today', timeIncrement: 1, token });
  if (linhas24h.length > 0) {
    await persistirMetricas(conta, entidade, normalizarLinhaInsight(linhas24h[0]), 24, coletadaEm);
  }

  await Entidade.findByIdAndUpdate(entidade._id, { ultimaSincronizacaoEm: coletadaEm });
}

/**
 * Persiste métricas normalizadas no Postgres.
 * Usa `ON CONFLICT DO UPDATE` em (entidade_id, metrica, janela_horas, coletada_em)
 * pra garantir idempotência — re-execução do mesmo tick não duplica linhas.
 */
export async function persistirMetricas(conta, entidade, metricasNormalizadas, janelaHoras, coletadaEm) {
  const linhasValidas = metricasNormalizadas.filter((m) => m.numerica && CONJUNTO_METRICAS_NUMERICAS.has(m.metrica));
  if (linhasValidas.length === 0) return;

  const valoresPorLinha = [];
  const placeholders = [];
  let i = 1;

  for (const { metrica, valor } of linhasValidas) {
    placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    valoresPorLinha.push(conta.identificador, String(entidade._id), entidade.tipo, metrica, valor, janelaHoras, coletadaEm);
  }

  await query(
    `
    INSERT INTO metricas_serie_temporal
      (conta_id, entidade_id, entidade_tipo, metrica, valor, janela_horas, coletada_em)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (entidade_id, metrica, janela_horas, coletada_em)
    DO UPDATE SET valor = EXCLUDED.valor
    `,
    valoresPorLinha
  );
}
