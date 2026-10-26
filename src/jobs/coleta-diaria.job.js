/**
 * Job diário de coleta — ver `orquestrador.js`.
 *
 * Uma passagem completa por conta ativa: fechamento dos últimos 7 dias com o
 * valor final da Meta e agregados de período (7d, 30d, mês, ciclo). É a única
 * coleta de métricas do sistema; o dashboard mostra até ontem.
 *
 * Falha em uma conta não impede as demais.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { coletarDiariaConta } from '../core/coleta/coletor-metricas.servico.js';
import { logger } from '../infra/logger.js';

export async function executarColetaDiaria() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de coleta diária', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const r = await coletarDiariaConta(String(conta._id));
      logger.info({ msg: 'Coleta diária concluída para conta', contaId: String(conta._id), fechamento: r.fechamento, periodos: r.periodos });
    } catch (erro) {
      logger.error({ msg: 'Falha na coleta diária para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
