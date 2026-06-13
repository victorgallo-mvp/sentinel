/**
 * Workers BullMQ do pipeline de investigação: triagem (Haiku) →
 * investigação (agente Sonnet com tool use) → notificação (WhatsApp).
 *
 * Cada etapa roda em sua própria fila para que uma falha (ex: rate limit
 * da Anthropic) não bloqueie as demais etapas nem outras anomalias.
 */
import { FILAS, criarWorker } from '../infra/fila.js';
import { triarAnomalia } from '../core/ia/triagem.servico.js';
import { investigarAnomalia } from '../core/agente/investigador.agente.js';
import { processarNotificacao } from '../core/notificacao/processador.servico.js';
import { logger } from '../infra/logger.js';

/**
 * Cria os workers de triagem, investigação e notificação.
 * @returns {Array<import('bullmq').Worker>}
 */
export function criarWorkersInvestigacao() {
  const workerTriagem = criarWorker(FILAS.TRIAGEM, async (job) => {
    const { anomaliaId } = job.data;
    return triarAnomalia(anomaliaId);
  });

  const workerInvestigacao = criarWorker(
    FILAS.INVESTIGACAO,
    async (job) => {
      const { anomaliaId } = job.data;
      return investigarAnomalia(anomaliaId);
    },
    { concurrency: 1 } // investigações usam Sonnet — evita rajadas de custo
  );

  const workerNotificacao = criarWorker(FILAS.NOTIFICAR, async (job) => {
    const { investigacaoId } = job.data;
    return processarNotificacao(investigacaoId);
  });

  logger.info({ msg: 'Workers do pipeline de investigação iniciados', filas: [FILAS.TRIAGEM, FILAS.INVESTIGACAO, FILAS.NOTIFICAR] });

  return [workerTriagem, workerInvestigacao, workerNotificacao];
}
