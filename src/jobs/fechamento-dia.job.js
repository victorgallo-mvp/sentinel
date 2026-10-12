/**
 * Job diário de fechamento — ver `orquestrador.js`.
 *
 * Regrava o snapshot de 24h dos últimos 7 dias (ontem inclusive) de todas as
 * entidades monitoradas com o valor final da Meta. Sete dias porque é a janela
 * de atribuição por clique: uma compra creditada três dias depois do anúncio
 * só aparece se o dia for relido. Falha em uma conta não impede as demais.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { coletarFechamentoDiasConta } from '../core/coleta/coletor-metricas.servico.js';
import { inicioDiaBRT } from '../shared/utils.js';
import { logger } from '../infra/logger.js';

export const DIAS_FECHAMENTO = 7;

/** Data BRT ('YYYY-MM-DD') de N dias atrás. */
export function dataBRT(diasAtras) {
  // inicioDiaBRT devolve 03:00Z do dia; a data UTC desse instante é a data BRT.
  return inicioDiaBRT(diasAtras).toISOString().slice(0, 10);
}

export async function executarFechamentoDia() {
  const intervalo = { since: dataBRT(DIAS_FECHAMENTO), until: dataBRT(1) };
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de fechamento de dias', totalContas: contas.length, ...intervalo });

  for (const conta of contas) {
    try {
      const resultado = await coletarFechamentoDiasConta(String(conta._id), intervalo);
      logger.info({ msg: 'Fechamento concluído para conta', contaId: String(conta._id), ...resultado });
    } catch (erro) {
      logger.error({ msg: 'Falha no fechamento para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
