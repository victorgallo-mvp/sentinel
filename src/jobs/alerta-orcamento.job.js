/**
 * Job de verificação de saldo de orçamento.
 * Roda a cada hora (minuto 10) — após a coleta (minuto 5), sem depender
 * do resultado dela. Chama a Meta API diretamente para verificar budget_remaining.
 */
import { verificarOrcamentosContas } from '../core/alertas/alerta-orcamento.servico.js';
import { logger } from '../infra/logger.js';

export async function executarAlertaOrcamento() {
  logger.info({ msg: 'Iniciando verificação de saldo de orçamento' });
  await verificarOrcamentosContas();
  logger.info({ msg: 'Verificação de saldo de orçamento concluída' });
}
