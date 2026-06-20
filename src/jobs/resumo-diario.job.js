/**
 * Job de resumo diário — dispara às 08h todo dia.
 * Envia via WhatsApp as métricas do dia anterior por conta monitorada.
 */
import { enviarResumoDiarioContas } from '../core/relatorio/resumo-diario.servico.js';
import { logger } from '../infra/logger.js';

export async function executarResumoDiario() {
  logger.info({ msg: 'Iniciando envio de resumo diário' });
  await enviarResumoDiarioContas();
  logger.info({ msg: 'Resumo diário concluído' });
}
