/**
 * Evita re-detectar a mesma anomalia em sequência: se já existe uma
 * Anomalia recente (dentro da janela de deduplicação) para a mesma
 * entidade+métrica+janela de medição, a nova detecção é descartada.
 */
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { JANELA_DEDUPLICACAO_HORAS } from '../../config/thresholds-padrao.js';

/**
 * @param {string} entidadeId
 * @param {string} metrica
 * @param {string} janelaMedicao - ex: "1h", "6h", "24h"
 * @returns {Promise<boolean>} true se já há detecção recente (deve pular)
 */
export async function foiDetectadaRecentemente(entidadeId, metrica, janelaMedicao) {
  const limite = new Date(Date.now() - JANELA_DEDUPLICACAO_HORAS * 60 * 60 * 1000);

  const existente = await Anomalia.findOne({
    entidadeId,
    metrica,
    janelaMedicao,
    detectadaEm: { $gte: limite },
  }).select('_id');

  return Boolean(existente);
}
