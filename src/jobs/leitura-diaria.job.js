/**
 * Job diário da leitura por IA — ver `orquestrador.js`.
 *
 * Roda depois do motor de sinais: para cada conta com sinal no dia, uma
 * chamada ao modelo e uma linha em `leituras_conta`. Conta sem sinal não
 * gera chamada. Falha numa conta não interrompe as demais.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { gerarLeituraConta, persistirLeitura, leituraAtiva } from '../core/sinais/leitura-diaria.servico.js';
import { logger } from '../infra/logger.js';

export async function executarLeituraDiaria() {
  if (!leituraAtiva()) {
    logger.info({ msg: 'Leitura diária desligada (IA_LEITURA_SINAIS_ATIVA=false)' });
    return;
  }
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando leitura diária dos sinais', totalContas: contas.length });

  let custoTotal = 0;
  let geradas = 0;
  for (const conta of contas) {
    try {
      const { dia, leitura, motivo } = await gerarLeituraConta(String(conta._id));
      if (!leitura) { logger.debug({ msg: 'Conta sem leitura', conta: conta.identificador, motivo }); continue; }
      await persistirLeitura(dia, leitura);
      custoTotal += leitura.custoUsd ?? 0;
      geradas++;
    } catch (erro) {
      logger.error({ msg: 'Falha na leitura diária da conta — seguindo com as demais', conta: conta.identificador, erro: erro.message });
    }
  }
  logger.info({ msg: 'Leitura diária concluída', geradas, custoUsd: Number(custoTotal.toFixed(4)) });
}
