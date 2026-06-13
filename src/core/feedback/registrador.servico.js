/**
 * Persiste feedback recebido do usuário e aplica efeitos colaterais
 * imediatos: marcar notificação como respondida e, no caso de "snooze",
 * silenciar temporariamente a métrica na entidade correspondente.
 */
import { Feedback } from '../../dominio/feedback.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';

const DURACAO_SNOOZE_HORAS = 4;

/**
 * Registra o feedback de uma notificação e aplica efeitos (snooze, se aplicável).
 * @param {string} notificacaoId
 * @param {{ classificacao: string, acao: string|null, comentarioLivre: string|null }} interpretacao
 */
export async function registrarFeedback(notificacaoId, interpretacao) {
  const notificacao = await Notificacao.findById(notificacaoId);
  if (!notificacao) throw new ErroNaoEncontrado(`Notificação ${notificacaoId} não encontrada`);

  const feedback = await Feedback.create({
    contaId: notificacao.contaId,
    notificacaoId: notificacao._id,
    classificacao: interpretacao.classificacao,
    comentarioLivre: interpretacao.comentarioLivre,
    recebidoEm: new Date(),
  });

  notificacao.status = 'respondida';
  notificacao.feedbackId = feedback._id;
  await notificacao.save();

  if (interpretacao.acao === 'snooze') {
    await aplicarSnooze(notificacao);
  }

  logger.info({ msg: 'Feedback registrado', notificacaoId, classificacao: interpretacao.classificacao });
  return feedback;
}

/** Silencia a métrica da anomalia original por `DURACAO_SNOOZE_HORAS` na entidade afetada. */
async function aplicarSnooze(notificacao) {
  const investigacao = await Investigacao.findById(notificacao.investigacaoId);
  if (!investigacao) return;

  const anomalia = await Anomalia.findById(investigacao.anomaliaId);
  if (!anomalia) return;

  const ate = new Date(Date.now() + DURACAO_SNOOZE_HORAS * 60 * 60 * 1000);

  await Entidade.findByIdAndUpdate(anomalia.entidadeId, {
    $push: { 'configuracoes.silenciamentos': { metrica: anomalia.metrica, ate } },
  });

  logger.info({ msg: 'Snooze aplicado', entidadeId: String(anomalia.entidadeId), metrica: anomalia.metrica, ate });
}

/**
 * Encontra a notificação mais recente enviada para um destinatário,
 * usada pelo webhook do Evolution pra associar a resposta recebida.
 */
export async function encontrarNotificacaoRecente(destinatario, dentroDeHoras = 48) {
  const limite = new Date(Date.now() - dentroDeHoras * 60 * 60 * 1000);

  return Notificacao.findOne({
    destinatario,
    enviadaEm: { $gte: limite },
    status: 'enviada',
  }).sort({ enviadaEm: -1 });
}
