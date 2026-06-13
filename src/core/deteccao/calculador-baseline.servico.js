/**
 * Serviço de cálculo de baselines — roda diariamente (job
 * `atualizar-baselines.job.js`). Para cada entidade monitorada e cada
 * métrica numérica, calcula média/desvio padrão/min/max dos últimos N
 * dias de histórico e faz upsert na tabela `baselines`.
 *
 * Entidades com menos que `MINIMO_OBSERVACOES_BASELINE` pontos no
 * histórico são puladas — dado insuficiente pra baseline confiável.
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { metricasNumericas } from '../../config/metricas.config.js';
import {
  MINIMO_OBSERVACOES_BASELINE,
  DIAS_HISTORICO_BASELINE_PADRAO,
} from '../../config/thresholds-padrao.js';
import { query } from '../../infra/postgres.js';
import { calcularMedia, calcularDesvioPadrao } from '../../shared/utils.js';
import { logger } from '../../infra/logger.js';

const JANELAS_HORAS = [1, 6, 24];
const METRICAS = metricasNumericas();

/**
 * Calcula e persiste baselines de todas as entidades monitoradas de uma conta.
 * @param {string} contaId - ObjectId da Conta
 */
export async function calcularBaselinesConta(contaId) {
  const conta = await Conta.findById(contaId);
  const diasHistorico = conta?.configuracoes?.diasHistoricoBaseline ?? DIAS_HISTORICO_BASELINE_PADRAO;

  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true });
  logger.info({ msg: 'Iniciando cálculo de baselines', contaId: String(contaId), totalEntidades: entidades.length });

  let calculados = 0;
  let pulados = 0;

  for (const entidade of entidades) {
    for (const janela of JANELAS_HORAS) {
      for (const metrica of METRICAS) {
        try {
          const resultado = await calcularBaselineEntidadeMetrica(
            conta.identificador,
            String(entidade._id),
            metrica,
            janela,
            diasHistorico
          );
          resultado ? calculados++ : pulados++;
        } catch (erro) {
          pulados++;
          logger.error({
            msg: 'Falha ao calcular baseline — pulando',
            entidadeId: String(entidade._id),
            metrica,
            janela,
            erro: erro.message,
          });
        }
      }
    }
  }

  logger.info({ msg: 'Cálculo de baselines concluído', contaId: String(contaId), calculados, pulados });
  return { calculados, pulados };
}

/**
 * Calcula o baseline de uma única combinação entidade+métrica+janela e
 * faz upsert em `baselines`. Retorna `false` se dado insuficiente.
 */
export async function calcularBaselineEntidadeMetrica(contaIdentificador, entidadeId, metrica, janelaHoras, diasHistorico) {
  const resultado = await query(
    `
    SELECT valor FROM metricas_serie_temporal
    WHERE entidade_id = $1 AND metrica = $2 AND janela_horas = $3
      AND coletada_em > NOW() - INTERVAL '1 day' * $4
    `,
    [entidadeId, metrica, janelaHoras, diasHistorico]
  );

  const valores = resultado.rows.map((r) => Number(r.valor));
  if (valores.length < MINIMO_OBSERVACOES_BASELINE) return false;

  const media = calcularMedia(valores);
  const desvioPadrao = calcularDesvioPadrao(valores, media);
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);

  await query(
    `
    INSERT INTO baselines (conta_id, entidade_id, metrica, janela_horas, media, desvio_padrao, minimo, maximo, quantidade_observacoes, dias_historico, calculado_em)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (conta_id, entidade_id, metrica, janela_horas)
    DO UPDATE SET
      media = EXCLUDED.media,
      desvio_padrao = EXCLUDED.desvio_padrao,
      minimo = EXCLUDED.minimo,
      maximo = EXCLUDED.maximo,
      quantidade_observacoes = EXCLUDED.quantidade_observacoes,
      dias_historico = EXCLUDED.dias_historico,
      calculado_em = NOW()
    `,
    [contaIdentificador, entidadeId, metrica, janelaHoras, media, desvioPadrao, minimo, maximo, valores.length, diasHistorico]
  );

  return true;
}
