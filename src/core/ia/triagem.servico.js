/**
 * Triagem rápida (Haiku) — antes de acionar o agente investigador caro
 * (Sonnet com tool use), um modelo barato decide se a anomalia merece
 * investigação profunda.
 *
 * Critérios: magnitude alta (>3 desvios), métrica crítica, ou impacto
 * financeiro provável.
 */
import { anthropic, calcularCusto, verificarLimiteCusto } from './cliente.claude.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { obterMetadadosMetrica } from '../../config/metricas.config.js';
import { config } from '../../config/index.js';
import { adicionarJob, FILAS } from '../../infra/fila.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado, ErroAnthropicApi, ErroLimiteCustoExcedido } from '../../shared/erros.js';

const MAX_TOKENS_RESPOSTA = 200;

/**
 * Triagem de uma anomalia: decide se merece investigação pelo agente.
 * @param {string} anomaliaId - ObjectId da Anomalia
 */
export async function triarAnomalia(anomaliaId) {
  const anomalia = await Anomalia.findById(anomaliaId);
  if (!anomalia) throw new ErroNaoEncontrado(`Anomalia ${anomaliaId} não encontrada`);

  const entidade = await Entidade.findById(anomalia.entidadeId);
  if (!entidade) throw new ErroNaoEncontrado(`Entidade ${anomalia.entidadeId} não encontrada`);

  const conta = await Conta.findById(anomalia.contaId);
  const limiteCustoDiarioUsd = conta?.configuracoes?.limiteCustoDiarioUsd ?? config.limites.custoDiarioUsd;

  let decisao;
  try {
    await verificarLimiteCusto(anomalia.contaId, limiteCustoDiarioUsd);
    decisao = await consultarHaiku(anomalia, entidade);
  } catch (erro) {
    if (erro instanceof ErroLimiteCustoExcedido) {
      logger.warn({ msg: 'Triagem pulada — limite de custo diário atingido', anomaliaId });
      decisao = { merece: false, motivo: 'Limite de custo diário atingido — triagem pulada.' };
    } else {
      // Falha na triagem não deve travar o pipeline: aplica heurística de fallback
      logger.error({ msg: 'Erro na triagem via Haiku — usando heurística de fallback', anomaliaId, erro: erro.message });
      decisao = decisaoFallback(anomalia);
    }
  }

  anomalia.triagem = {
    mereceInvestigacao: decisao.merece,
    motivoBreve: decisao.motivo,
    realizadaEm: new Date(),
  };
  anomalia.statusProcessamento = decisao.merece ? 'triada' : 'ignorada';
  await anomalia.save();

  if (decisao.merece) {
    await adicionarJob(FILAS.INVESTIGACAO, 'investigacao', { anomaliaId: String(anomalia._id) });
  }

  logger.info({ msg: 'Triagem concluída', anomaliaId, merece: decisao.merece, motivo: decisao.motivo });
  return decisao;
}

/** Chama o modelo de triagem (Haiku) e retorna `{ merece, motivo }`. */
async function consultarHaiku(anomalia, entidade) {
  const prompt = construirPromptTriagem(anomalia, entidade);

  const resposta = await anthropic.messages.create({
    model: config.anthropic.modeloTriagem,
    max_tokens: MAX_TOKENS_RESPOSTA,
    messages: [{ role: 'user', content: prompt }],
  });

  const custoUsd = calcularCusto(resposta.usage, config.anthropic.modeloTriagem);
  logger.info({ msg: 'Custo da triagem', anomaliaId: String(anomalia._id), custoUsd: custoUsd.toFixed(6) });

  const textoResposta = resposta.content.find((c) => c.type === 'text')?.text ?? '';

  try {
    const json = extrairJson(textoResposta);
    return {
      merece: Boolean(json.merece),
      motivo: String(json.motivo ?? '').slice(0, 500),
    };
  } catch (erro) {
    throw new ErroAnthropicApi('Resposta de triagem não pôde ser interpretada como JSON', { textoResposta, erro: erro.message });
  }
}

/** Extrai o primeiro bloco JSON de um texto (tolera texto extra antes/depois). */
function extrairJson(texto) {
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio === -1 || fim === -1) throw new Error('JSON não encontrado na resposta');
  return JSON.parse(texto.slice(inicio, fim + 1));
}

function construirPromptTriagem(anomalia, entidade) {
  const metadados = obterMetadadosMetrica(anomalia.metrica);
  const nomeMetrica = metadados?.nome ?? anomalia.metrica;

  return `Anomalia detectada:
- Métrica: ${nomeMetrica} (${anomalia.metrica})
- Entidade: ${entidade.nome} (${entidade.tipo})
- Valor atual: ${anomalia.valorAtual}
- Baseline: ${anomalia.baselineMedia} (±${anomalia.baselineDesvio})
- Magnitude: ${anomalia.magnitudeDesvios.toFixed(2)} desvios padrão
- Direção: ${anomalia.direcao}
- Janela de medição: ${anomalia.janelaMedicao}
- Relevância da métrica: ${metadados?.relevancia ?? 'desconhecida'}

Essa anomalia merece investigação profunda por agente de IA?
Critérios: magnitude alta (>3 desvios), métrica crítica, ou impacto financeiro provável.

Retorne APENAS um JSON no formato: { "merece": true|false, "motivo": "breve explicação" }`;
}

/**
 * Heurística de fallback quando a chamada ao Haiku falha: investiga se
 * magnitude alta ou métrica crítica, evitando perder anomalias importantes.
 */
function decisaoFallback(anomalia) {
  const metadados = obterMetadadosMetrica(anomalia.metrica);
  const merece = anomalia.magnitudeDesvios > 3 || metadados?.relevancia === 'critica';

  return {
    merece,
    motivo: merece
      ? 'Fallback: magnitude alta ou métrica crítica — investigação acionada por segurança.'
      : 'Fallback: magnitude e relevância dentro do esperado — ignorada.',
  };
}
