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

// Janelas agregadas (168h=7d, 720h=30d, 744h=mês): TODOS os pontos que as leem
// usam só a linha mais recente de cada entidade+métrica — `DISTINCT ON ... ORDER BY
// coletada_em DESC` ou `LIMIT 1` (veredito, resumo diário, alerta de performance e
// o dashboard); o detector de anomalias ignora tudo que não seja a janela de 24h.
// O histórico delas é, portanto, escrito e nunca lido. Guardamos alguns dias como
// margem para falha de coleta e descartamos o resto.
const RETENCAO_JANELAS_AGREGADAS_DIAS = 7;

// Snapshots horários da janela de 24h: depois desta idade, guarda só o último de
// cada dia — exatamente o que o dashboard lê. Precisa cobrir com folga os
// DIAS_HISTORICO_BASELINE_PADRAO (21) que a detecção de anomalias consome.
const CONSOLIDAR_24H_APOS_DIAS = 30;

// Apaga em lotes para não segurar lock nem montar uma transação gigante.
const TAMANHO_LOTE_EXCLUSAO = 20000;

/** Remove métricas e registros operacionais mais antigos que a retenção configurada. */
export async function executarLimpezaDadosAntigos() {
  const limiteMetricas = new Date(Date.now() - RETENCAO_METRICAS_DIAS * 24 * 60 * 60 * 1000);
  const limiteRegistros = new Date(Date.now() - RETENCAO_REGISTROS_DIAS * 24 * 60 * 60 * 1000);

  logger.info({ msg: 'Iniciando job de limpeza de dados antigos', limiteMetricas, limiteRegistros });

  await limparComLog('metricas_serie_temporal — fora da retenção', async () => {
    const resultado = await query('DELETE FROM metricas_serie_temporal WHERE coletada_em < $1', [limiteMetricas]);
    return resultado.rowCount;
  });

  await limparComLog('metricas_serie_temporal — histórico das janelas 7d/30d/mês', () =>
    apagarEmLotes(
      `SELECT m.id FROM metricas_serie_temporal m
       WHERE m.janela_horas <> 24 AND m.coletada_em < $1
         AND EXISTS (
           SELECT 1 FROM metricas_serie_temporal n
           WHERE n.entidade_id = m.entidade_id AND n.metrica = m.metrica
             AND n.janela_horas = m.janela_horas AND n.coletada_em > m.coletada_em
         )`,
      [diasAtras(RETENCAO_JANELAS_AGREGADAS_DIAS)]
    )
  );

  await limparComLog('metricas_serie_temporal — consolidação dos snapshots horários', () =>
    apagarEmLotes(
      `SELECT m.id FROM metricas_serie_temporal m
       WHERE m.janela_horas = 24 AND m.coletada_em < $1
         AND EXISTS (
           SELECT 1 FROM metricas_serie_temporal n
           WHERE n.entidade_id = m.entidade_id AND n.metrica = m.metrica
             AND n.janela_horas = 24 AND n.coletada_em > m.coletada_em
             AND date_trunc('day', n.coletada_em AT TIME ZONE 'America/Sao_Paulo')
               = date_trunc('day', m.coletada_em AT TIME ZONE 'America/Sao_Paulo')
         )`,
      [diasAtras(CONSOLIDAR_24H_APOS_DIAS)]
    )
  );

  // Devolve o espaço das linhas apagadas para reuso do próprio Postgres. Não
  // encolhe o arquivo em disco (isso exigiria VACUUM FULL, que precisa do dobro
  // do tamanho livre), mas impede a tabela de crescer indefinidamente.
  await limparComLog('VACUUM ANALYZE metricas_serie_temporal', async () => {
    await query('VACUUM ANALYZE metricas_serie_temporal');
    return 0;
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

/** Timestamp de N dias atrás. */
function diasAtras(dias) {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/**
 * Apaga em lotes as linhas devolvidas por `sqlIds`.
 *
 * As consultas de seleção nunca alcançam a linha MAIS RECENTE de cada grupo:
 * elas só marcam uma linha quando existe outra mais nova no mesmo grupo. Assim,
 * uma entidade que parou de ser coletada mantém o último valor que o dashboard
 * ainda lê, em vez de sumir da tela.
 */
async function apagarEmLotes(sqlIds, parametros) {
  let total = 0;
  for (;;) {
    const resultado = await query(
      `DELETE FROM metricas_serie_temporal
       WHERE id IN (${sqlIds} LIMIT ${TAMANHO_LOTE_EXCLUSAO})`,
      parametros
    );
    total += resultado.rowCount;
    if (resultado.rowCount < TAMANHO_LOTE_EXCLUSAO) return total;
  }
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
