/**
 * Controles anti-spam de notificação:
 * - Respeita horário permitido e dias úteis configurados na conta.
 * - Respeita silenciamentos temporários ("snooze") criados via feedback.
 * - Evita notificar a mesma combinação entidade+métrica mais de uma vez
 *   dentro de uma janela mínima.
 */
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';

const JANELA_MINIMA_REPETICAO_HORAS = 4;

/**
 * Verifica se uma notificação pode ser enviada agora.
 * @returns {Promise<{podeEnviar: boolean, motivo: string|null}>}
 */
export async function podeNotificar(conta, entidade, anomalia) {
  if (!dentroDoHorarioPermitido(conta)) {
    return { podeEnviar: false, motivo: 'Fora do horário/dia permitido para notificações.' };
  }

  if (estaSilenciada(entidade, anomalia.metrica)) {
    return { podeEnviar: false, motivo: `Métrica "${anomalia.metrica}" silenciada temporariamente (snooze) para esta entidade.` };
  }

  const repeticaoRecente = await notificacaoRecenteParaMetrica(conta._id, entidade._id, anomalia.metrica);
  if (repeticaoRecente) {
    return { podeEnviar: false, motivo: `Já houve notificação para "${anomalia.metrica}" nesta entidade nas últimas ${JANELA_MINIMA_REPETICAO_HORAS}h.` };
  }

  return { podeEnviar: true, motivo: null };
}

/** Verifica horário permitido (HH:MM) e dia da semana configurados na conta. */
function dentroDoHorarioPermitido(conta) {
  const notificacao = conta?.notificacao ?? {};
  const agora = new Date();
  const diaSemana = agora.getDay();

  const diasUteis = notificacao.diasUteis ?? [0, 1, 2, 3, 4, 5, 6];
  if (!diasUteis.includes(diaSemana)) return false;

  const inicio = notificacao.horarioPermitidoInicio ?? '00:00';
  const fim = notificacao.horarioPermitidoFim ?? '23:59';

  const minutoAgora = agora.getHours() * 60 + agora.getMinutes();
  const minutoInicio = paraMinutos(inicio);
  const minutoFim = paraMinutos(fim);

  return minutoAgora >= minutoInicio && minutoAgora <= minutoFim;
}

function paraMinutos(horaStr) {
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Verifica se a métrica está silenciada (snooze) e ainda não expirou. */
function estaSilenciada(entidade, metrica) {
  const silenciamentos = entidade?.configuracoes?.silenciamentos ?? [];
  const agora = new Date();
  return silenciamentos.some((s) => s.metrica === metrica && new Date(s.ate) > agora);
}

/** Verifica se já houve notificação recente pra essa entidade+métrica. */
async function notificacaoRecenteParaMetrica(contaId, entidadeId, metrica) {
  const limite = new Date(Date.now() - JANELA_MINIMA_REPETICAO_HORAS * 60 * 60 * 1000);

  const anomaliasRecentes = await Anomalia.find({
    entidadeId,
    metrica,
    detectadaEm: { $gte: limite },
  }).select('_id');

  if (anomaliasRecentes.length === 0) return false;

  const notificacaoExistente = await Notificacao.findOne({
    contaId,
    investigacaoId: { $exists: true },
    enviadaEm: { $gte: limite },
    status: { $ne: 'erro' },
  }).populate({ path: 'investigacaoId', select: 'anomaliaId' });

  if (!notificacaoExistente) return false;

  const idsAnomaliasRecentes = new Set(anomaliasRecentes.map((a) => String(a._id)));
  return idsAnomaliasRecentes.has(String(notificacaoExistente.investigacaoId?.anomaliaId));
}

export { JANELA_MINIMA_REPETICAO_HORAS };
