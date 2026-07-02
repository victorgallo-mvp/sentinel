/**
 * Job diário de coleta dos agregados de período (7 e 30 dias) — ver `orquestrador.js`.
 * A Meta entrega esses valores já agregados/deduplicados pelo período, o que não dá
 * para reconstruir dos snapshots diários. Alimenta o gasto 7d/30d e as métricas
 * deduplicadas (frequência/alcance) do dashboard. Atualiza 1×/dia. Falha em uma
 * conta não impede as demais.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { coletarMetricasPeriodosConta } from '../core/coleta/coletor-metricas.servico.js';
import { logger } from '../infra/logger.js';

export async function executarColetaPeriodos() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de coleta de períodos (7d/30d)', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const resultado = await coletarMetricasPeriodosConta(String(conta._id));
      logger.info({ msg: 'Coleta de períodos concluída para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha na coleta de períodos para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
