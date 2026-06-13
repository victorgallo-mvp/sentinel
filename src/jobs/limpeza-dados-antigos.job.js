/**
 * Job de limpeza de dados antigos — roda via cron (diariamente).
 * Remove séries temporais e registros operacionais antigos para manter o
 * uso dos bancos (Postgres/Mongo, ambos em tiers gratuitos) sob controle.
 *
 * Falha na limpeza de um recurso não impede a limpeza dos demais.
 */
import { query } from '../infra/postgres.js';
import { Anomalia } from '../dominio/anomalia.modelo.js';
import { Investigacao } from '../dominio/investigacao.modelo.js';
import { Notificacao } from '../dominio/notificacao.modelo.js';
import { Feedback } from '../dominio/feedback.modelo.js';
import { logger } from '../infra/logger.js';

const RETENCAO_METRICAS_DIAS = 90;
const RETENCAO_REGISTROS_DIAS = 180;

/** Remove métricas e registros operacionais mais antigos que a retenção configurada. */
export async function executarLimpezaDadosAntigos() {
  const limiteMetricas = new Date(Date.now() - RETENCAO_METRICAS_DIAS * 24 * 60 * 60 * 1000);
  const limiteRegistros = new Date(Date.now() - RETENCAO_REGISTROS_DIAS * 24 * 60 * 60 * 1000);

  logger.info({ msg: 'Iniciando job de limpeza de dados antigos', limiteMetricas, limiteRegistros });

  await limparComLog('metricas_serie_temporal (Postgres)', async () => {
    const resultado = await query('DELETE FROM metricas_serie_temporal WHERE coletada_em < $1', [limiteMetricas]);
    return resultado.rowCount;
  });

  await limparComLog('notificacoes', async () => {
    const resultado = await Notificacao.deleteMany({ enviadaEm: { $lt: limiteRegistros } });
    return resultado.deletedCount;
  });

  await limparComLog('investigacoes', async () => {
    const resultado = await Investigacao.deleteMany({ criadoEm: { $lt: limiteRegistros } });
    return resultado.deletedCount;
  });

  await limparComLog('anomalias', async () => {
    const resultado = await Anomalia.deleteMany({
      detectadaEm: { $lt: limiteRegistros },
      statusProcessamento: { $in: ['investigada', 'notificada', 'ignorada'] },
    });
    return resultado.deletedCount;
  });

  await limparComLog('feedbacks', async () => {
    const resultado = await Feedback.deleteMany({ recebidoEm: { $lt: limiteRegistros } });
    return resultado.deletedCount;
  });

  logger.info({ msg: 'Job de limpeza de dados antigos concluído' });
}

/** Executa uma limpeza isolando falhas e registrando o total removido. */
async function limparComLog(recurso, executar) {
  try {
    const total = await executar();
    logger.info({ msg: 'Limpeza concluída', recurso, totalRemovido: total });
  } catch (erro) {
    logger.error({ msg: 'Falha ao limpar recurso — seguindo com os demais', recurso, erro: erro.message });
  }
}
