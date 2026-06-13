/**
 * Job periódico de detecção de anomalias — roda via cron, após a coleta de
 * métricas. Para cada conta ativa, compara os valores mais recentes contra
 * os baselines e enfileira anomalias detectadas para triagem.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { detectarAnomaliasConta } from '../core/deteccao/detector-anomalia.servico.js';
import { logger } from '../infra/logger.js';

/** Executa a detecção de anomalias para todas as contas ativas. */
export async function executarDeteccaoAnomalias() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de detecção de anomalias', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const resultado = await detectarAnomaliasConta(String(conta._id));
      logger.info({ msg: 'Detecção de anomalias concluída para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha na detecção de anomalias para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
