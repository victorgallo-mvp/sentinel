/**
 * Job diário de coleta do agregado de 30 dias das métricas deduplicadas
 * (frequência, alcance, cliques únicos) — ver `orquestrador.js`. A Meta entrega
 * esses valores já deduplicados pelo período, o que não dá para reconstruir dos
 * snapshots diários. Atualiza 1×/dia. Falha em uma conta não impede as demais.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { coletarMetricas30dConta } from '../core/coleta/coletor-metricas.servico.js';
import { logger } from '../infra/logger.js';

export async function executarColeta30d() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de coleta 30d (métricas deduplicadas)', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const resultado = await coletarMetricas30dConta(String(conta._id));
      logger.info({ msg: 'Coleta 30d concluída para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha na coleta 30d para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
