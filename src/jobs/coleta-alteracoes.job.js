/**
 * Job diário do registro de alterações — ver `orquestrador.js`.
 *
 * Relê os últimos 3 dias de cada conta ativa. A folga cobre atrasos da Meta
 * em publicar eventos e qualquer madrugada em que o job não rodou; como a
 * gravação é idempotente por chave, reler não duplica.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { coletarAlteracoesConta } from '../core/alteracoes/coletor-alteracoes.servico.js';
import { dataBRT } from './fechamento-dia.job.js';
import { logger } from '../infra/logger.js';

export const DIAS_RELEITURA = 3;

export async function executarColetaAlteracoes() {
  const intervalo = { since: dataBRT(DIAS_RELEITURA), until: dataBRT(0) };
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de coleta de alterações', totalContas: contas.length, ...intervalo });

  for (const conta of contas) {
    try {
      const resultado = await coletarAlteracoesConta(String(conta._id), intervalo);
      logger.info({ msg: 'Alterações coletadas para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha na coleta de alterações para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
