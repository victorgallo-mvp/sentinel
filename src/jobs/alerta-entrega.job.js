/**
 * Job de verificação de erros de entrega via issues_info.
 * Roda a cada hora (minuto 15) — após a coleta (minuto 5).
 */
import { verificarErrosEntrega } from '../core/alertas/alerta-entrega.servico.js';
import { logger } from '../infra/logger.js';

export async function executarAlertaEntrega() {
  logger.info({ msg: 'Iniciando verificação de erros de entrega' });
  await verificarErrosEntrega();
  logger.info({ msg: 'Verificação de erros de entrega concluída' });
}
