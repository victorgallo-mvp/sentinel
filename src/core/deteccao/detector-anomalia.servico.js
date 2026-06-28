/**
 * Serviço de detecção de anomalias — roda após cada coleta
 * (`deteccao-anomalias.job.js`). Compara o valor mais recente de cada
 * métrica com o baseline calculado e, se o desvio ultrapassar a
 * sensibilidade configurada, cria um registro `Anomalia` e enfileira
 * para triagem.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { query } from '../../infra/postgres.js';
import { calcularMagnitudeDesvios } from '../../shared/utils.js';
import { resolverSensibilidade, metricaIgnorada } from './configurador-thresholds.js';
import { foiDetectadaRecentemente } from './deduplicador-anomalias.js';
import { adicionarJob, FILAS } from '../../infra/fila.js';
import { logger } from '../../infra/logger.js';

const NOMES_JANELA = { 1: '1h', 6: '6h', 24: '24h' };

/**
 * Roda a detecção de anomalias para todas as entidades monitoradas de uma conta.
 * @param {string} contaId - ObjectId da Conta
 */
export async function detectarAnomaliasConta(contaId) {
  const conta = await Conta.findById(contaId);
  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true });
  const entidadesPorId = new Map(entidades.map((e) => [String(e._id), e]));

  const baselinesResultado = await query(
    `SELECT * FROM baselines WHERE conta_id = $1 AND quantidade_observacoes >= 10`,
    [conta.identificador]
  );

  logger.info({ msg: 'Iniciando detecção de anomalias', contaId: String(contaId), totalBaselines: baselinesResultado.rows.length });

  let detectadas = 0;
  let analisadas = 0;

  for (const baseline of baselinesResultado.rows) {
    const entidade = entidadesPorId.get(baseline.entidade_id);
    if (!entidade) continue; // entidade não monitorada (mais) — ignora baseline órfão

    if (metricaIgnorada(entidade, baseline.metrica)) continue;

    // A detecção opera apenas na janela diária (24h). Métricas em janelas curtas
    // (1h/6h) — sobretudo taxas como CPC/CPM/CTR — oscilam demais com poucas
    // amostras e geravam a maior parte das investigações (ruído). Alertas urgentes
    // ficam a cargo dos jobs por regra (orçamento/entrega/performance), que rodam
    // de hora em hora sem LLM.
    if (baseline.janela_horas !== 24) continue;

    try {
      analisadas++;
      const criou = await avaliarBaseline(conta, entidade, baseline);
      if (criou) detectadas++;
    } catch (erro) {
      logger.error({
        msg: 'Falha ao avaliar baseline — pulando',
        entidadeId: baseline.entidade_id,
        metrica: baseline.metrica,
        janelaHoras: baseline.janela_horas,
        erro: erro.message,
      });
    }
  }

  logger.info({ msg: 'Detecção de anomalias concluída', contaId: String(contaId), analisadas, detectadas });
  return { analisadas, detectadas };
}

/**
 * Avalia um único baseline contra o valor mais recente. Retorna `true`
 * se uma anomalia foi criada.
 */
async function avaliarBaseline(conta, entidade, baseline) {
  const valorAtual = await obterValorMaisRecente(baseline.entidade_id, baseline.metrica, baseline.janela_horas);
  if (valorAtual === null) return false;

  const media = Number(baseline.media);
  const desvioPadrao = Number(baseline.desvio_padrao);
  if (!desvioPadrao || desvioPadrao === 0) return false;

  const sensibilidade = resolverSensibilidade(conta, entidade, baseline.metrica);
  const limiteSuperior = media + sensibilidade * desvioPadrao;
  const limiteInferior = media - sensibilidade * desvioPadrao;

  if (valorAtual <= limiteSuperior && valorAtual >= limiteInferior) return false;

  const janelaMedicao = NOMES_JANELA[baseline.janela_horas] ?? `${baseline.janela_horas}h`;

  if (await foiDetectadaRecentemente(baseline.entidade_id, baseline.metrica, janelaMedicao)) {
    return false;
  }

  // Antes de criar a anomalia, verifica se o valor está dentro do baseline
  // histórico para esta mesma hora do dia — evita falsos positivos intraday
  // (e.g. "queda de gasto" às 11h quando o histórico às 11h também é baixo).
  const esperadoParaHora = await verificarBaselineHorario(
    baseline.entidade_id, baseline.metrica, baseline.janela_horas, valorAtual
  );
  if (esperadoParaHora) return false;

  const direcao = valorAtual > limiteSuperior ? 'aumento' : 'queda';
  const magnitude = calcularMagnitudeDesvios(valorAtual, media, desvioPadrao);

  const anomalia = await Anomalia.create({
    contaId: conta._id,
    entidadeId: entidade._id,
    metrica: baseline.metrica,
    valorAtual,
    baselineMedia: media,
    baselineDesvio: desvioPadrao,
    magnitudeDesvios: magnitude,
    direcao,
    janelaMedicao,
    detectadaEm: new Date(),
    statusProcessamento: 'detectada',
  });

  await adicionarJob(FILAS.TRIAGEM, 'triagem', { anomaliaId: String(anomalia._id) });

  logger.info({
    msg: 'Anomalia detectada',
    anomaliaId: String(anomalia._id),
    entidadeId: String(entidade._id),
    metrica: baseline.metrica,
    direcao,
    magnitudeDesvios: magnitude.toFixed(2),
  });

  return true;
}

/**
 * Verifica se `valorAtual` está dentro do comportamento histórico esperado
 * para esta mesma hora do dia (últimos 21 dias). Retorna `true` se estiver
 * dentro de 2σ do baseline horário — ou seja, anomalia pode ser descartada.
 *
 * Mínimo de 5 observações históricas no mesmo horário para ser conclusivo.
 */
async function verificarBaselineHorario(entidadeId, metrica, janelaHoras, valorAtual) {
  const horaAtual = new Date().getUTCHours();

  const res = await query(
    `SELECT valor FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND metrica = $2 AND janela_horas = $3
       AND EXTRACT(HOUR FROM coletada_em AT TIME ZONE 'UTC') = $4
       AND coletada_em >= NOW() - INTERVAL '21 days'
       AND coletada_em < NOW() - INTERVAL '2 hours'
     ORDER BY coletada_em DESC`,
    [entidadeId, metrica, janelaHoras, horaAtual]
  );

  if (res.rows.length < 5) return false;

  const valores = res.rows.map((r) => Number(r.valor));
  const n = valores.length;
  const media = valores.reduce((a, b) => a + b, 0) / n;
  const desvio = Math.sqrt(valores.reduce((a, b) => a + (b - media) ** 2, 0) / n);

  if (desvio === 0) return Math.abs(valorAtual - media) < 0.001;

  return Math.abs((valorAtual - media) / desvio) < 2.0;
}

/** Busca o valor mais recente de uma métrica pra uma entidade+janela. */
async function obterValorMaisRecente(entidadeId, metrica, janelaHoras) {
  const resultado = await query(
    `
    SELECT valor FROM metricas_serie_temporal
    WHERE entidade_id = $1 AND metrica = $2 AND janela_horas = $3
    ORDER BY coletada_em DESC
    LIMIT 1
    `,
    [entidadeId, metrica, janelaHoras]
  );

  if (resultado.rows.length === 0) return null;
  return Number(resultado.rows[0].valor);
}
