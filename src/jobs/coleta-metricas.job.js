/**
 * Job periódico de coleta de métricas — roda via cron (ver `orquestrador.js`).
 * Para cada conta ativa, coleta métricas de todas as entidades monitoradas.
 * Falha em uma conta não impede a coleta das demais.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { coletarMetricasConta } from '../core/coleta/coletor-metricas.servico.js';
import { logger } from '../infra/logger.js';

/** Executa a coleta de métricas para todas as contas ativas. */
export async function executarColetaMetricas() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de coleta de métricas', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const resultado = await coletarMetricasConta(String(conta._id));
      logger.info({ msg: 'Coleta de métricas concluída para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha na coleta de métricas para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
