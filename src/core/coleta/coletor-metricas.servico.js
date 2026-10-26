/**
 * Coleta de métricas — UMA passagem completa por dia (job `coleta-diaria`).
 *
 * Duas partes, ambas em poucas chamadas por conta de anúncio:
 *
 * 1. Fechamento dos últimos 7 dias: o valor final que a Meta reporta para
 *    cada dia, por campanha, conjunto e anúncio, gravado na janela de 24h com
 *    carimbo fixo às 23:59 BRT do dia. Sete dias porque a atribuição de
 *    compras e leads ainda muda por alguns dias depois do clique.
 *
 * 2. Agregados nativos de período (7d, 30d, mês e ciclo do cliente): a Meta
 *    deduplica alcance e frequência entre dias, o que não se reconstrói dos
 *    diários. Uma linha por entidade e período, janela_horas = horas do período.
 *
 * Até 26/10/2026 havia também uma coleta HORÁRIA por entidade (janelas 1h, 6h
 * e acumulado do dia), 2 chamadas por entidade por hora — 118 mil chamadas e
 * 180 mil linhas por dia, das quais dois terços ninguém lia. Saiu por custo.
 * Consequência: o dashboard mostra até ontem, não "hoje".
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { obterInsights, obterInsightsNivel, CAMPO_ID_POR_NIVEL } from './meta-api.cliente.js';
import { normalizarLinhaInsight } from './normalizador.js';
import { metricasNumericas } from '../../config/metricas.config.js';
import { query } from '../../infra/postgres.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';
import { arredondarParaIntervalo, dataBRT } from '../../shared/utils.js';
import { janelaCicloAtual, JANELA_CICLO_HORAS } from '../../shared/ciclo.js';

const JANELA_ARREDONDAMENTO_MINUTOS = 5;
const CONJUNTO_METRICAS_NUMERICAS = new Set(metricasNumericas());

/** Dias relidos no fechamento: a janela de atribuição por clique da Meta. */
export const DIAS_FECHAMENTO = 7;

// Níveis coletados — os mesmos que o dashboard exibe.
const NIVEIS = ['campaign', 'adset', 'ad'];

// Períodos agregados. 30d alimenta as métricas deduplicadas e o gasto de 30d;
// 7d o gasto de 7d; this_month (744) o gasto do mês-calendário.
const PERIODOS_AGREGADOS = [
  { datePreset: 'last_7d',    janelaHoras: 168 },
  { datePreset: 'last_30d',   janelaHoras: 720 },
  { datePreset: 'this_month', janelaHoras: 744 },
];

/**
 * Carimbo do snapshot de fechamento de um dia: 23:59 BRT daquele dia, em UTC.
 * Fixo, para que refazer o mesmo dia atualize a mesma linha (`ON CONFLICT`
 * em entidade+métrica+janela+coletada_em) em vez de acumular.
 *
 * @param {string} dataIso - 'YYYY-MM-DD' no fuso do anunciante (BRT)
 */
export function carimboFechamentoDia(dataIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) throw new Error(`Data inválida para fechamento: ${dataIso}`);
  return new Date(`${dataIso}T23:59:00-03:00`);
}

/** Entidades monitoradas da conta, indexadas pelo id da Meta. */
async function mapaEntidades(contaId) {
  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true }).select('_id metaId tipo').lean();
  return new Map(entidades.map((e) => [e.metaId, e]));
}

/**
 * Regrava o snapshot de 24h de cada dia do intervalo com o valor final que a
 * Meta reporta agora. Três consultas por conta de anúncio, uma linha por
 * entidade e dia. Serve ao job diário e ao backfill de períodos sem coleta.
 *
 * @param {string} contaId - ObjectId da Conta
 * @param {{ since: string, until: string }} intervalo - 'YYYY-MM-DD', inclusivo
 */
export async function coletarFechamentoDiasConta(contaId, { since, until }) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);
  const token = conta.metaConfig?.systemUserToken || undefined;
  const porMetaId = await mapaEntidades(contaId);

  const tocadas = new Set();
  let linhas = 0;
  let ignoradas = 0;
  let falhas = 0;

  for (const contaAnuncioId of conta.metaConfig?.contasAnuncioIds ?? []) {
    for (const nivel of NIVEIS) {
      try {
        const insights = await obterInsightsNivel(contaAnuncioId, nivel, { timeRange: { since, until }, timeIncrement: 1, token });
        const itens = [];
        for (const linha of insights) {
          const entidade = porMetaId.get(linha[CAMPO_ID_POR_NIVEL[nivel]]);
          if (!entidade) { ignoradas++; continue; }
          tocadas.add(entidade._id);
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

  if (tocadas.size) {
    await Entidade.updateMany({ _id: { $in: [...tocadas] } }, { $set: { ultimaSincronizacaoEm: new Date() } });
  }

  logger.info({ msg: 'Fechamento de dias concluído', contaId: String(contaId), since, until, linhas, ignoradas, falhas });
  return { linhas, ignoradas, falhas };
}

/**
 * Agregados nativos de período (7d, 30d, mês, ciclo) de todas as entidades
 * monitoradas da conta — três consultas por conta de anúncio e período, mais
 * uma no nível conta para alcance/frequência deduplicados entre campanhas.
 */
export async function coletarPeriodosConta(contaId) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);
  const token = conta.metaConfig?.systemUserToken || undefined;
  const porMetaId = await mapaEntidades(contaId);
  const agora = arredondarParaIntervalo(new Date(), JANELA_ARREDONDAMENTO_MINUTOS);

  // Ciclo do cliente: só faz sentido quando difere do mês-calendário, que o
  // preset `this_month` já cobre.
  const diaInicioCiclo = conta.configuracoes?.diaInicioCiclo ?? 1;
  const periodos = diaInicioCiclo === 1
    ? PERIODOS_AGREGADOS
    : [...PERIODOS_AGREGADOS, { timeRange: janelaCicloAtual(diaInicioCiclo), janelaHoras: JANELA_CICLO_HORAS }];

  let linhas = 0;
  let falhas = 0;

  for (const contaAnuncioId of conta.metaConfig?.contasAnuncioIds ?? []) {
    for (const periodo of periodos) {
      const intervalo = periodo.timeRange
        ? { timeRange: { since: periodo.timeRange.since, until: periodo.timeRange.until } }
        : { datePreset: periodo.datePreset };

      for (const nivel of NIVEIS) {
        try {
          const insights = await obterInsightsNivel(contaAnuncioId, nivel, { ...intervalo, timeIncrement: 'all_days', token });
          const itens = insights
            .map((linha) => ({ entidade: porMetaId.get(linha[CAMPO_ID_POR_NIVEL[nivel]]), linha }))
            .filter(({ entidade }) => entidade)
            .map(({ entidade, linha }) => ({ entidade, metricas: normalizarLinhaInsight(linha), janelaHoras: periodo.janelaHoras, coletadaEm: agora }));
          await persistirLoteMetricas(conta, itens);
          linhas += itens.length;
        } catch (erro) {
          falhas++;
          logger.error({ msg: 'Falha ao coletar período por nível — pulando', contaId: String(contaId), contaAnuncioId, nivel, periodo: periodo.datePreset ?? 'ciclo', erro: erro.message });
        }
      }

      try {
        await coletarMetricasPeriodoContaAnuncio(conta, contaAnuncioId, periodo, agora);
      } catch (erro) {
        falhas++;
        logger.error({ msg: 'Falha ao coletar período no nível conta — pulando', contaAnuncioId, periodo: periodo.datePreset ?? 'ciclo', erro: erro.message });
      }
    }
  }

  logger.info({ msg: 'Coleta de períodos concluída', contaId: String(contaId), linhas, falhas });
  return { linhas, falhas };
}

/**
 * A passagem diária completa de uma conta: fechamento dos últimos 7 dias
 * (ontem inclusive) e agregados de período.
 */
export async function coletarDiariaConta(contaId) {
  const fechamento = await coletarFechamentoDiasConta(contaId, { since: dataBRT(DIAS_FECHAMENTO), until: dataBRT(1) });
  const periodos = await coletarPeriodosConta(contaId);
  return { fechamento, periodos };
}

/**
 * Coleta um período no nível CONTA DE ANÚNCIO e persiste com
 * `entidade_id = act_...` e `entidade_tipo = 'account'`.
 *
 * Essas linhas ficam FORA da coleção `entidades` do MongoDB de propósito: o
 * dashboard e os alertas consultam por entidade monitorada, então nada disso
 * passa a enxergar o nível conta por acidente — e nenhum somatório de gasto
 * conta o mesmo dinheiro duas vezes. Quem quiser o alcance deduplicado da
 * conta lê explicitamente `entidade_tipo = 'account'`.
 */
export async function coletarMetricasPeriodoContaAnuncio(conta, contaAnuncioId, { datePreset, timeRange, janelaHoras }, coletadaEm = new Date()) {
  const token = conta.metaConfig?.systemUserToken || undefined;
  const linhas = await obterInsights('account', contaAnuncioId, {
    ...(timeRange ? { timeRange: { since: timeRange.since, until: timeRange.until } } : { datePreset }),
    timeIncrement: 'all_days',
    token,
  });
  if (!linhas.length) return;

  await persistirMetricas(conta, { _id: contaAnuncioId, tipo: 'account' }, normalizarLinhaInsight(linhas[0]), janelaHoras, coletadaEm);
}

/**
 * Persiste métricas normalizadas no Postgres.
 * Usa `ON CONFLICT DO UPDATE` em (entidade_id, metrica, janela_horas, coletada_em)
 * pra garantir idempotência — re-execução não duplica linhas.
 */
export async function persistirMetricas(conta, entidade, metricasNormalizadas, janelaHoras, coletadaEm) {
  await persistirLoteMetricas(conta, [{ entidade, metricas: metricasNormalizadas, janelaHoras, coletadaEm }]);
}

// Linhas por INSERT. O Postgres aceita 65.535 parâmetros por comando; com 7 por
// linha, 5.000 linhas ficam bem abaixo disso.
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
