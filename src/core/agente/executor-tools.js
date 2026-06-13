/**
 * Roteia e instrumenta a execução de tools chamadas pelo agente investigador:
 * loga cada chamada, mede duração, captura erros (sem derrubar o loop) e
 * resume resultados grandes antes de salvar no histórico da investigação.
 */
import { executarTool } from '../tools/registro.tools.js';
import { logger } from '../../infra/logger.js';

const TAMANHO_MAXIMO_RESUMO = 4000; // caracteres — evita inflar demais o documento Investigacao

/**
 * Executa uma tool chamada pelo agente, com tratamento de erro.
 * @returns {Promise<{resultado: Object, duracaoMs: number, erro: string|null}>}
 */
export async function executarToolComLog(nomeTool, parametros, contexto, iteracao) {
  const inicio = Date.now();
  let resultado;
  let erro = null;

  logger.info({ msg: 'Agente chamou tool', tool: nomeTool, parametros, iteracao });

  try {
    resultado = await executarTool(nomeTool, parametros, contexto);
  } catch (erroExecucao) {
    erro = erroExecucao.message;
    resultado = { erro: erroExecucao.message };
    logger.error({ msg: 'Erro ao executar tool', tool: nomeTool, erro: erroExecucao.message, iteracao });
  }

  const duracaoMs = Date.now() - inicio;

  if (duracaoMs > 3000) {
    logger.warn({ msg: 'Tool demorou mais que o esperado (>3s)', tool: nomeTool, duracaoMs });
  }

  return { resultado, duracaoMs, erro };
}

/** Resume um resultado de tool pra armazenamento no histórico (evita documentos gigantes). */
export function resumirResultado(resultado) {
  const texto = JSON.stringify(resultado);
  if (texto.length <= TAMANHO_MAXIMO_RESUMO) return resultado;

  return {
    resumoTruncado: true,
    tamanhoOriginal: texto.length,
    amostra: `${texto.slice(0, TAMANHO_MAXIMO_RESUMO)}...`,
  };
}
