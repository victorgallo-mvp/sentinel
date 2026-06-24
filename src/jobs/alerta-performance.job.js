/**
 * Job de verificações de performance sem baseline.
 * Roda a cada hora (minuto 25) — após a detecção de anomalias (minuto 20).
 * Verifica frequência de saturação e zero conversões.
 */
import { verificarPerformance } from '../core/alertas/alerta-performance.servico.js';
import { logger } from '../infra/logger.js';

export async function executarAlertaPerformance() {
  logger.info({ msg: 'Iniciando verificação de alertas de performance' });
  await verificarPerformance();
  logger.info({ msg: 'Verificação de alertas de performance concluída' });
}
