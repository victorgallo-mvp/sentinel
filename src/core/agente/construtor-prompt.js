/**
 * Monta o system prompt e o prompt inicial enviados ao agente investigador.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { obterMetadadosMetrica } from '../../config/metricas.config.js';
import { config } from '../../config/index.js';
import { arredondar } from '../../shared/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_PROMPT_SYSTEM = path.resolve(__dirname, '../../../prompts/investigador-system.md');

let cacheSystemPrompt = null;

/** Carrega o system prompt do agente investigador, com placeholders substituídos. */
export async function carregarPromptSystem() {
  if (!cacheSystemPrompt) {
    const conteudo = await readFile(CAMINHO_PROMPT_SYSTEM, 'utf-8');
    cacheSystemPrompt = conteudo.replaceAll('{MAX_ITERACOES}', String(config.limites.maxIteracoesAgente));
  }
  return cacheSystemPrompt;
}

/**
 * Monta a mensagem inicial do usuário descrevendo a anomalia detectada,
 * incluindo metadados da entidade e da métrica pra dar contexto ao agente.
 *
 * @param {Object} anomalia - documento Anomalia (populado com entidadeId/contaId)
 * @param {Object} entidade - documento Entidade
 */
export function construirPromptInicial(anomalia, entidade) {
  const metadados = obterMetadadosMetrica(anomalia.metrica);
  const nomeMetrica = metadados?.nome ?? anomalia.metrica;

  return `Uma anomalia foi detectada pelo pipeline de monitoramento. Investigue e gere um diagnóstico + decisão de notificação.

## Anomalia detectada

- **Métrica:** ${nomeMetrica} (\`${anomalia.metrica}\`)
- **Relevância da métrica:** ${metadados?.relevancia ?? 'desconhecida'}
- **Direção esperada (quando "boa"):** ${metadados?.direcaoBoa ?? 'desconhecida'}
- **Valor atual:** ${arredondar(anomalia.valorAtual, 4)}
- **Baseline (média):** ${arredondar(anomalia.baselineMedia, 4)} (±${arredondar(anomalia.baselineDesvio, 4)})
- **Magnitude do desvio:** ${arredondar(anomalia.magnitudeDesvios, 2)} desvios padrão
- **Direção do desvio:** ${anomalia.direcao}
- **Janela de medição:** ${anomalia.janelaMedicao}
- **Detectada em:** ${anomalia.detectadaEm.toISOString()}

## Entidade afetada

- **Nome:** ${entidade.nome}
- **Tipo:** ${entidade.tipo}
- **Objetivo da campanha:** ${entidade.objetivo ?? 'desconhecido'}
- **Status:** ${entidade.status}

## Triagem prévia

${anomalia.triagem?.motivoBreve ? `Motivo da triagem: ${anomalia.triagem.motivoBreve}` : 'N/A'}

Investigue usando as ferramentas disponíveis, registre seu diagnóstico e decida sobre notificação.`;
}
