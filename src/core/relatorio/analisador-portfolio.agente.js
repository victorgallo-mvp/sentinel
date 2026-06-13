/**
 * Agente de análise de portfólio — uma única chamada ao Claude Sonnet
 * (sem tool use) que recebe os dados agregados da semana e devolve um
 * resumo executivo em markdown, usado no relatório semanal.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { anthropic, calcularCusto } from '../ia/cliente.claude.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { ErroAnthropicApi } from '../../shared/erros.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_PROMPT_SYSTEM = path.resolve(__dirname, '../../../prompts/analise-portfolio.md');

let cacheSystemPrompt = null;

async function carregarPromptSystem() {
  if (!cacheSystemPrompt) {
    cacheSystemPrompt = await readFile(CAMINHO_PROMPT_SYSTEM, 'utf-8');
  }
  return cacheSystemPrompt;
}

/**
 * Analisa o portfólio semanal de uma conta e gera um resumo executivo.
 *
 * @param {Object} conta - documento Conta
 * @param {Array} dadosPortfolio - saída de `compilarDadosPortfolio`
 * @param {Object} resumoOperacional - saída de `compilarResumoOperacional`
 * @param {Date} periodoInicio
 * @param {Date} periodoFim
 * @returns {Promise<{resumoTexto: string, custoUsd: number, modelo: string}>}
 */
export async function analisarPortfolio(conta, dadosPortfolio, resumoOperacional, periodoInicio, periodoFim) {
  const modelo = config.anthropic.modeloAgente;

  if (dadosPortfolio.length === 0) {
    logger.warn({ msg: 'Nenhum dado de portfólio para análise semanal', contaId: String(conta._id) });
    return {
      resumoTexto: '## Visão geral da semana\n\nNenhum dado de métricas foi encontrado para o período. Verifique se a coleta de métricas está ativa.',
      custoUsd: 0,
      modelo,
    };
  }

  const promptSystem = await carregarPromptSystem();

  const entradaUsuario = JSON.stringify(
    {
      conta: conta.nome,
      periodo: { inicio: periodoInicio.toISOString(), fim: periodoFim.toISOString() },
      resumoOperacional,
      entidades: dadosPortfolio,
    },
    null,
    2
  );

  try {
    const resposta = await anthropic.messages.create({
      model: modelo,
      max_tokens: 2048,
      system: promptSystem,
      messages: [{ role: 'user', content: `Dados da semana:\n\n${entradaUsuario}` }],
    });

    const bloco = resposta.content.find((c) => c.type === 'text');
    const resumoTexto = bloco?.text ?? '';
    const custoUsd = calcularCusto(resposta.usage, modelo);

    logger.info({ msg: 'Análise de portfólio gerada', contaId: String(conta._id), custoUsd: custoUsd.toFixed(4) });

    return { resumoTexto, custoUsd, modelo };
  } catch (erro) {
    logger.error({ msg: 'Falha ao gerar análise de portfólio', contaId: String(conta._id), erro: erro.message });
    throw new ErroAnthropicApi('Falha ao chamar Claude para análise de portfólio', { causa: erro.message });
  }
}
