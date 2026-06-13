/**
 * Controle de limite de iterações do loop do agente investigador.
 * Hard cap configurável (`MAX_ITERACOES_AGENTE`), com warning a partir
 * da iteração 7 — registrado no log e mencionado no histórico de
 * raciocínio (via system prompt).
 */
import { config } from '../../config/index.js';

export const MAX_ITERACOES = config.limites.maxIteracoesAgente;
export const ITERACAO_WARNING = 7;

/** Retorna true se a iteração atual já atingiu o limite máximo (deve parar). */
export function limiteAtingido(iteracao) {
  return iteracao >= MAX_ITERACOES;
}

/** Retorna true se a iteração atual está na zona de warning (deve convergir). */
export function emZonaDeWarning(iteracao) {
  return iteracao >= ITERACAO_WARNING && iteracao < MAX_ITERACOES;
}
