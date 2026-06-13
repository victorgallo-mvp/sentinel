/**
 * Wrapper sobre o SDK oficial da Anthropic (`@anthropic-ai/sdk`).
 * Centraliza a instância do cliente, cálculo de custo por chamada e
 * verificação do limite de gasto diário (proteção contra loops caros
 * do agente investigador).
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { ErroLimiteCustoExcedido } from '../../shared/erros.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Relatorio } from '../../dominio/relatorio.modelo.js';

export const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * Tabela de preços por milhão de tokens (USD).
 * IMPORTANTE: confira os valores atuais em https://docs.claude.com antes
 * de usar em produção — preços podem mudar.
 */
const PRECOS_POR_MILHAO_TOKENS = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

/** Calcula o custo em USD de uma chamada com base no `usage` retornado pela API. */
export function calcularCusto(usage, modelo) {
  const precos = PRECOS_POR_MILHAO_TOKENS[modelo] ?? PRECOS_POR_MILHAO_TOKENS['claude-sonnet-4-5'];
  const tokensEntrada = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
  const tokensSaida = usage?.output_tokens ?? 0;

  const custoEntrada = (tokensEntrada / 1_000_000) * precos.input;
  const custoSaida = (tokensSaida / 1_000_000) * precos.output;

  return custoEntrada + custoSaida;
}

/**
 * Verifica se a conta já atingiu o limite de custo diário configurado.
 * Soma o custo de investigações + relatórios gerados desde 00:00 (hoje).
 *
 * @param {string} contaId - ObjectId da Conta
 * @param {number} limiteCustoDiarioUsd - limite configurado para a conta
 * @throws {ErroLimiteCustoExcedido} se o limite já foi atingido
 */
export async function verificarLimiteCusto(contaId, limiteCustoDiarioUsd = config.limites.custoDiarioUsd) {
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const [investigacoes, relatorios] = await Promise.all([
    Investigacao.find({ contaId, criadoEm: { $gte: inicioDoDia } }).select('custoTokensUsd'),
    Relatorio.find({ contaId, criadoEm: { $gte: inicioDoDia } }).select('custoTokensUsd'),
  ]);

  const gastoHoje =
    investigacoes.reduce((soma, i) => soma + (i.custoTokensUsd || 0), 0) +
    relatorios.reduce((soma, r) => soma + (r.custoTokensUsd || 0), 0);

  if (gastoHoje >= limiteCustoDiarioUsd) {
    logger.warn({ msg: 'Limite de custo diário atingido', contaId: String(contaId), gastoHoje, limiteCustoDiarioUsd });
    throw new ErroLimiteCustoExcedido(
      `Limite de custo diário (US$ ${limiteCustoDiarioUsd.toFixed(2)}) atingido. Gasto hoje: US$ ${gastoHoje.toFixed(4)}`,
      { gastoHoje, limiteCustoDiarioUsd }
    );
  }

  return { gastoHoje, limiteCustoDiarioUsd, margemRestante: limiteCustoDiarioUsd - gastoHoje };
}
