/**
 * Serviço de coleta de métricas — roda periodicamente (job de coleta) e,
 * para cada entidade monitorada de uma conta, busca insights na Meta API
 * e persiste em `metricas_serie_temporal` (Postgres) nas janelas 1h, 6h e 24h.
 *
 * Falha em uma entidade NÃO interrompe a coleta das demais.
 *
 * A janela de 24h tem dois produtores. O job horário grava o acumulado do dia
 * a cada tick; o último tick cai entre 23:05 e 23:35 BRT, então o dia nunca
 * fecha inteiro — e a atribuição de compras/leads que a Meta ainda vai creditar
 * fica de fora para sempre. O fechamento diário (`coletarFechamentoDiasConta`)
 * regrava os últimos dias com o valor final da Meta, carimbado às 23:59 do dia,
 * que é o que toda leitura de "último snapshot do dia" passa a enxergar.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { obterInsights, obterInsightsHorarios, obterInsightsNivel, CAMPO_ID_POR_NIVEL } from './meta-api.cliente.js';
import { normalizarLinhaInsight, agregarLinhasHorarias } from './normalizador.js';
import { metricasNumericas } from '../../config/metricas.config.js';
import { query } from '../../infra/postgres.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';
import { arredondarParaIntervalo } from '../../shared/utils.js';
import { janelaCicloAtual, JANELA_CICLO_HORAS } from '../../shared/ciclo.js';

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
 * Coleta o agregado REAL de um período (linha única) de uma entidade e persiste
 * em `metricas_serie_temporal` com a `janelaHoras` do período. A Meta deduplica
 * alcance/frequência entre dias — algo impossível de reconstruir dos snapshots
 * diários. Usado pelas métricas deduplicadas e pelo gasto 7d/30d/mês. Roda 1×/dia.
 *
 * Aceita `datePreset` (períodos fixos) ou `timeRange` (`{since, until}`), usado
 * pelo ciclo de faturamento do cliente, que não tem preset equivalente.
 */
export async function coletarMetricasPeriodoEntidade(conta, entidade, { datePreset, timeRange, janelaHoras }, coletadaEm = new Date()) {
  const token = conta.metaConfig?.systemUserToken || undefined;
  const linhas = await obterInsights(entidade.tipo, entidade.metaId, {
    ...(timeRange ? { timeRange: { since: timeRange.since, until: timeRange.until } } : { datePreset }),
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

  // Ciclo do cliente: só faz sentido quando difere do mês-calendário, que o
  // preset `this_month` já cobre.
  const diaInicioCiclo = conta.configuracoes?.diaInicioCiclo ?? 1;
  const periodos = diaInicioCiclo === 1
    ? PERIODOS_AGREGADOS
    : [...PERIODOS_AGREGADOS, { timeRange: janelaCicloAtual(diaInicioCiclo), janelaHoras: JANELA_CICLO_HORAS }];

  for (const entidade of entidades) {
    for (const periodo of periodos) {
      try {
        await coletarMetricasPeriodoEntidade(conta, entidade, periodo, agora);
        sucesso++;
      } catch (erro) {
        falhas++;
        logger.error({ msg: 'Falha ao coletar período de entidade — pulando', entidadeId: String(entidade._id), metaId: entidade.metaId, periodo: periodo.datePreset ?? 'ciclo', erro: erro.message });
      }
    }
  }

  // Nível conta: alcance e frequência deduplicados entre TODAS as campanhas.
  // Não dá para reconstruir somando campanhas — a mesma pessoa é alcançada por
  // várias, e a Meta só deduplica de verdade quando perguntada neste nível.
  for (const contaAnuncioId of conta.metaConfig?.contasAnuncioIds ?? []) {
    for (const periodo of periodos) {
      try {
        await coletarMetricasPeriodoContaAnuncio(conta, contaAnuncioId, periodo, agora);
        sucesso++;
      } catch (erro) {
        falhas++;
        logger.error({ msg: 'Falha ao coletar período no nível conta — pulando', contaAnuncioId, periodo: periodo.datePreset ?? 'ciclo', erro: erro.message });
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

// Níveis refeitos pelo fechamento diário — os mesmos que o dashboard exibe.
const NIVEIS_FECHAMENTO = ['campaign', 'adset', 'ad'];

/**
 * Carimbo do snapshot de fechamento de um dia: 23:59 BRT daquele dia, em UTC.
 *
 * É mais tarde que qualquer tick horário (23:35 no máximo) e ainda cai dentro do
 * dia BRT nas consultas (`< dia seguinte 03:00Z`), então vence como "último
 * snapshot do dia". Fixo, para que refazer o mesmo dia atualize a mesma linha
 * (`ON CONFLICT` em entidade+métrica+janela+coletada_em) em vez de acumular.
 *
 * @param {string} dataIso - 'YYYY-MM-DD' no fuso do anunciante (BRT)
 */
export function carimboFechamentoDia(dataIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) throw new Error(`Data inválida para fechamento: ${dataIso}`);
  return new Date(`${dataIso}T23:59:00-03:00`);
}

/**
 * Regrava, para uma conta, o snapshot de 24h de cada dia do intervalo com o
 * valor final que a Meta reporta agora. Três consultas por conta de anúncio
 * (campanhas, conjuntos, anúncios), uma linha por entidade e dia.
 *
 * Serve tanto ao job diário (últimos 7 dias, para cobrir a janela de
 * atribuição) quanto ao backfill de períodos sem coleta. Linhas de entidades
 * que não estão monitoradas são ignoradas — o dashboard não as lê.
 *
 * @param {string} contaId - ObjectId da Conta
 * @param {{ since: string, until: string }} intervalo - datas 'YYYY-MM-DD', inclusivas
 */
export async function coletarFechamentoDiasConta(contaId, { since, until }) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);
  const token = conta.metaConfig?.systemUserToken || undefined;

  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true })
    .select('_id metaId tipo').lean();
  const porMetaId = new Map(entidades.map((e) => [e.metaId, e]));

  let linhas = 0;
  let ignoradas = 0;
  let falhas = 0;

  for (const contaAnuncioId of conta.metaConfig?.contasAnuncioIds ?? []) {
    for (const nivel of NIVEIS_FECHAMENTO) {
      try {
        const insights = await obterInsightsNivel(contaAnuncioId, nivel, { timeRange: { since, until }, timeIncrement: 1, token });
        const itens = [];
        for (const linha of insights) {
          const entidade = porMetaId.get(linha[CAMPO_ID_POR_NIVEL[nivel]]);
          if (!entidade) { ignoradas++; continue; }
          itens.push({ entidade, metricas: normalizarLinhaInsight(linha), janelaHoras: 24, coletadaEm: carimboFechamentoDia(linha.date_start) });
        }
        await persistirLoteMetricas(conta, itens);
        linhas += itens.length;
      } catch (erro) {
        falhas++;
        logger.error({ msg: 'Falha no fechamento de dias — pulando nível', contaId: String(contaId), contaAnuncioId, nivel, since, until, erro: erro.message });
      }
    }
  }

  logger.info({ msg: 'Fechamento de dias concluído', contaId: String(contaId), since, until, linhas, ignoradas, falhas });
  return { linhas, ignoradas, falhas };
}

/**
 * Coleta um período no nível CONTA DE ANÚNCIO e persiste com
 * `entidade_id = act_...` e `entidade_tipo = 'account'`.
 *
 * Essas linhas ficam FORA da coleção `entidades` do MongoDB de propósito: o
 * dashboard, os alertas e a detecção de anomalias consultam por entidade
 * monitorada, então nada disso passa a enxergar o nível conta por acidente —
 * e, principalmente, nenhum somatório de gasto passa a contar o mesmo dinheiro
 * duas vezes. Quem quiser o alcance deduplicado da conta lê explicitamente
 * `entidade_tipo = 'account'`.
 */
export async function coletarMetricasPeriodoContaAnuncio(conta, contaAnuncioId, { datePreset, timeRange, janelaHoras }, coletadaEm = new Date()) {
  const token = conta.metaConfig?.systemUserToken || undefined;
  const linhas = await obterInsights('account', contaAnuncioId, {
    ...(timeRange ? { timeRange: { since: timeRange.since, until: timeRange.until } } : { datePreset }),
    timeIncrement: 'all_days',
    token,
  });
  if (!linhas.length) return;

  await persistirMetricas(
    conta,
    { _id: contaAnuncioId, tipo: 'account' },
    normalizarLinhaInsight(linhas[0]),
    janelaHoras,
    coletadaEm
  );
}

/**
 * Persiste métricas normalizadas no Postgres.
 * Usa `ON CONFLICT DO UPDATE` em (entidade_id, metrica, janela_horas, coletada_em)
 * pra garantir idempotência — re-execução do mesmo tick não duplica linhas.
 */
export async function persistirMetricas(conta, entidade, metricasNormalizadas, janelaHoras, coletadaEm) {
  await persistirLoteMetricas(conta, [{ entidade, metricas: metricasNormalizadas, janelaHoras, coletadaEm }]);
}

// Linhas por INSERT. O Postgres aceita 65.535 parâmetros por comando; com 7 por
// linha, 5.000 linhas ficam bem abaixo disso e ainda cortam a ida e volta ao
// banco em centenas de vezes no fechamento de dias.
const LINHAS_POR_INSERT = 5000;

/**
 * Persiste as métricas de VÁRIAS entidades/instantes em poucos INSERTs.
 * Mesma chave de idempotência de `persistirMetricas`.
 *
 * @param {Object} conta
 * @param {Array<{ entidade: {_id: any, tipo: string}, metricas: Array, janelaHoras: number, coletadaEm: Date }>} itens
 */
export async function persistirLoteMetricas(conta, itens) {
  const linhas = [];
  for (const { entidade, metricas, janelaHoras, coletadaEm } of itens) {
    for (const { metrica, valor, numerica } of metricas) {
      if (!numerica || !CONJUNTO_METRICAS_NUMERICAS.has(metrica)) continue;
      linhas.push([conta.identificador, String(entidade._id), entidade.tipo, metrica, valor, janelaHoras, coletadaEm]);
    }
  }

  for (let inicio = 0; inicio < linhas.length; inicio += LINHAS_POR_INSERT) {
    const lote = linhas.slice(inicio, inicio + LINHAS_POR_INSERT);
    const placeholders = [];
    const valores = [];
    let i = 1;
    for (const linha of lote) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      valores.push(...linha);
    }
    await query(
      `
      INSERT INTO metricas_serie_temporal
        (conta_id, entidade_id, entidade_tipo, metrica, valor, janela_horas, coletada_em)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (entidade_id, metrica, janela_horas, coletada_em)
      DO UPDATE SET valor = EXCLUDED.valor
      `,
      valores
    );
  }
}
