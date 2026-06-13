/**
 * Analisa feedback acumulado por entidade+métrica e sugere ajustes de
 * sensibilidade (threshold de desvios padrão).
 *
 * V1: apenas sugere (retorna recomendações, sem aplicar).
 * V2: aplicar automaticamente as sugestões com confiança alta.
 */
import { Feedback } from '../../dominio/feedback.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { logger } from '../../infra/logger.js';

const MINIMO_FEEDBACKS_PARA_SUGESTAO = 5;
const PROPORCAO_RUIDO_PARA_AUMENTAR = 0.6; // 60% dos feedbacks como "ruído"
const INCREMENTO_SENSIBILIDADE = 0.5;

/**
 * Analisa o feedback dos últimos N dias de uma conta e sugere ajustes
 * de `sensibilidadeCustom` por entidade+métrica.
 * @param {string} contaId
 * @param {number} dias
 * @returns {Promise<Array<{entidadeId: string, metrica: string, sugestao: string, detalhes: Object}>>}
 */
export async function sugerirAjustesSensibilidade(contaId, dias = 14) {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const feedbacks = await Feedback.find({ contaId, recebidoEm: { $gte: desde } }).select('notificacaoId classificacao');
  if (feedbacks.length === 0) return [];

  const contagemPorChave = new Map();

  for (const feedback of feedbacks) {
    const chave = await resolverChaveEntidadeMetrica(feedback.notificacaoId);
    if (!chave) continue;

    const atual = contagemPorChave.get(chave.id) ?? { ...chave, util: 0, ruido: 0, total: 0 };
    atual.total++;
    if (feedback.classificacao === 'util') atual.util++;
    if (feedback.classificacao === 'ruido') atual.ruido++;
    contagemPorChave.set(chave.id, atual);
  }

  const sugestoes = [];

  for (const dados of contagemPorChave.values()) {
    if (dados.total < MINIMO_FEEDBACKS_PARA_SUGESTAO) continue;

    const proporcaoRuido = dados.ruido / dados.total;
    if (proporcaoRuido >= PROPORCAO_RUIDO_PARA_AUMENTAR) {
      const entidade = await Entidade.findById(dados.entidadeId).select('configuracoes.sensibilidadeCustom');
      const atual = entidade?.configuracoes?.sensibilidadeCustom ?? null;
      sugestoes.push({
        entidadeId: dados.entidadeId,
        metrica: dados.metrica,
        sugestao: 'aumentar_sensibilidade',
        detalhes: {
          proporcaoRuido: Number(proporcaoRuido.toFixed(2)),
          totalFeedbacks: dados.total,
          sensibilidadeAtual: atual,
          sensibilidadeSugerida: (atual ?? 2.5) + INCREMENTO_SENSIBILIDADE,
        },
      });
    }
  }

  logger.info({ msg: 'Sugestões de ajuste de sensibilidade geradas', contaId, total: sugestoes.length });
  return sugestoes;
}

/** Resolve entidadeId+metrica a partir de uma notificação, via investigação > anomalia. */
async function resolverChaveEntidadeMetrica(notificacaoId) {
  const notificacao = await Notificacao.findById(notificacaoId).select('investigacaoId');
  if (!notificacao) return null;

  const investigacao = await Investigacao.findById(notificacao.investigacaoId).select('anomaliaId');
  if (!investigacao) return null;

  const anomalia = await Anomalia.findById(investigacao.anomaliaId).select('entidadeId metrica');
  if (!anomalia) return null;

  return {
    id: `${anomalia.entidadeId}:${anomalia.metrica}`,
    entidadeId: String(anomalia.entidadeId),
    metrica: anomalia.metrica,
  };
}

/**
 * Aplica uma sugestão específica (usado manualmente ou por V2 automaticamente).
 * @param {string} entidadeId
 * @param {number} novaSensibilidade
 */
export async function aplicarAjusteSensibilidade(entidadeId, novaSensibilidade) {
  await Entidade.findByIdAndUpdate(entidadeId, { 'configuracoes.sensibilidadeCustom': novaSensibilidade });
  logger.info({ msg: 'Sensibilidade ajustada manualmente', entidadeId, novaSensibilidade });
}
