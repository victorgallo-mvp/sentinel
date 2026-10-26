/**
 * Job diário do motor de sinais — ver `orquestrador.js`.
 *
 * Roda depois da coleta diária e gera, por conta, os achados de desperdício e
 * risco do dia. Substitui o snapshot anterior do mesmo dia; sem IA.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { gerarSinaisConta, persistirSinais } from '../core/sinais/motor-sinais.servico.js';
import { logger } from '../infra/logger.js';

export async function executarSinaisDiarios() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de sinais diários', totalContas: contas.length });

  for (const conta of contas) {
    try {
      const { dia, sinais } = await gerarSinaisConta(String(conta._id));
      await persistirSinais(conta.identificador, dia, sinais);
      const desperdicio = sinais.reduce((s, x) => s + (x.desperdicioDia ?? 0), 0);
      logger.info({ msg: 'Sinais gerados para conta', contaId: String(conta._id), dia, sinais: sinais.length, desperdicioDia: Number(desperdicio.toFixed(2)) });
    } catch (erro) {
      logger.error({ msg: 'Falha ao gerar sinais para conta — seguindo com as demais', contaId: String(conta._id), erro: erro.message });
    }
  }
}
