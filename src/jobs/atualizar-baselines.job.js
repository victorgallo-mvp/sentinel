/**
 * Job periódico de atualização de baselines — roda via cron (diariamente).
 * Para cada conta ativa, recalcula média/desvio padrão de cada
 * entidade+métrica+janela com base no histórico recente.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { calcularBaselinesConta } from '../core/deteccao/calculador-baseline.servico.js';
import { logger } from '../infra/logger.js';

/** Executa a atualização de baselines para todas as contas ativas. */
export async function executarAtualizacaoBaselines() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de atualização de baselines', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const resultado = await calcularBaselinesConta(String(conta._id));
      logger.info({ msg: 'Atualização de baselines concluída para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha na atualização de baselines para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
