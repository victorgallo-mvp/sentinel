/**
 * Resolve a sensibilidade (em desvios padrão) aplicável a uma combinação
 * de conta + entidade + métrica, respeitando a hierarquia de overrides:
 *
 *   1. `entidade.configuracoes.sensibilidadeCustom` (mais específico)
 *   2. `conta.configuracoes.sensibilidadePadrao`
 *   3. `SENSIBILIDADE_POR_METRICA[metrica]` (padrão do sistema por métrica)
 *   4. `SENSIBILIDADE_PADRAO` (fallback geral)
 */
import { SENSIBILIDADE_PADRAO, obterSensibilidadeMetrica } from '../../config/thresholds-padrao.js';

/**
 * @param {Object} conta - documento Conta (Mongoose)
 * @param {Object} entidade - documento Entidade (Mongoose)
 * @param {string} metrica
 * @returns {number} sensibilidade em desvios padrão
 */
export function resolverSensibilidade(conta, entidade, metrica) {
  if (entidade?.configuracoes?.sensibilidadeCustom != null) {
    return entidade.configuracoes.sensibilidadeCustom;
  }

  if (conta?.configuracoes?.sensibilidadePadrao != null) {
    // sensibilidade da conta funciona como override do padrão por métrica
    return conta.configuracoes.sensibilidadePadrao;
  }

  return obterSensibilidadeMetrica(metrica) ?? SENSIBILIDADE_PADRAO;
}

/** Verifica se uma métrica está na lista de métricas ignoradas da entidade. */
export function metricaIgnorada(entidade, metrica) {
  return (entidade?.configuracoes?.metricasIgnoradas ?? []).includes(metrica);
}
