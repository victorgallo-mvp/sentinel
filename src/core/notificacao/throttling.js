/**
 * Controles anti-spam de notificação:
 * - Respeita horário permitido e dias úteis configurados na conta.
 * - Respeita silenciamentos temporários ("snooze") criados via feedback.
 * - Evita notificar a mesma combinação entidade+métrica mais de uma vez
 *   dentro de uma janela mínima.
 */
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';

const JANELA_MINIMA_REPETICAO_HORAS = 4;

/**
 * Verifica se uma notificação pode ser enviada agora.
 * O `codigo` permite ao chamador distinguir o tipo de bloqueio — em especial
 * `fora_horario`, que deve ser ADIADO (reenfileirado) e não descartado.
 * @returns {Promise<{podeEnviar: boolean, motivo: string|null, codigo: string|null}>}
 */
export async function podeNotificar(conta, entidade, anomalia) {
  if (!dentroDoHorarioPermitido(conta)) {
    return { podeEnviar: false, motivo: 'Fora do horário/dia permitido para notificações.', codigo: 'fora_horario' };
  }

  if (estaSilenciada(entidade, anomalia.metrica)) {
    return { podeEnviar: false, motivo: `Métrica "${anomalia.metrica}" silenciada temporariamente (snooze) para esta entidade.`, codigo: 'silenciada' };
  }

  const repeticaoRecente = await notificacaoRecenteParaMetrica(conta._id, entidade._id, anomalia.metrica);
  if (repeticaoRecente) {
    return { podeEnviar: false, motivo: `Já houve notificação para "${anomalia.metrica}" nesta entidade nas últimas ${JANELA_MINIMA_REPETICAO_HORAS}h.`, codigo: 'repeticao' };
  }

  return { podeEnviar: true, motivo: null, codigo: null };
}

/**
 * Calcula quantos milissegundos faltam até a próxima abertura da janela de
 * notificação permitida (horarioPermitidoInicio em um dia útil configurado).
 * Usa o horário local do servidor — mesma base de `dentroDoHorarioPermitido`.
 * @returns {number} ms até a próxima abertura (sempre > 0)
 */
export function msAteProximaAberturaJanela(conta) {
  const notificacao = conta?.notificacao ?? {};
  const diasUteis = notificacao.diasUteis ?? [0, 1, 2, 3, 4, 5, 6];
  const inicio = paraMinutos(notificacao.horarioPermitidoInicio ?? '08:00');
  const agora = new Date();

  // Procura o próximo instante (hoje ou nos próximos 7 dias) em que a janela abre.
  for (let i = 0; i < 8; i++) {
    const candidato = new Date(agora);
    candidato.setDate(agora.getDate() + i);
    candidato.setHours(Math.floor(inicio / 60), inicio % 60, 0, 0);
    if (!diasUteis.includes(candidato.getDay())) continue;
    if (candidato.getTime() > agora.getTime()) return candidato.getTime() - agora.getTime();
  }
  return 60 * 60 * 1000; // fallback defensivo: 1h
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

/**
 * Verifica se já houve notificação recente pra essa entidade+métrica.
 * Considera TODAS as notificações enviadas na janela (não apenas a mais recente):
 * resolve cada uma até a anomalia de origem e checa se alguma corresponde a esta
 * combinação entidade+métrica. Ancorado no horário da notificação — assim funciona
 * mesmo quando a conta teve várias notificações de entidades/métricas diferentes.
 */
async function notificacaoRecenteParaMetrica(contaId, entidadeId, metrica) {
  const limite = new Date(Date.now() - JANELA_MINIMA_REPETICAO_HORAS * 60 * 60 * 1000);

  // Notificações de investigação enviadas para esta conta na janela
  const notificacoes = await Notificacao.find({
    contaId,
    investigacaoId: { $exists: true },
    enviadaEm: { $gte: limite },
    status: { $ne: 'erro' },
  }).select('investigacaoId');

  if (notificacoes.length === 0) return false;

  // Investigações correspondentes → anomalias de origem
  const investigacaoIds = notificacoes.map((n) => n.investigacaoId);
  const investigacoes = await Investigacao.find({ _id: { $in: investigacaoIds } }).select('anomaliaId');
  if (investigacoes.length === 0) return false;

  const anomaliaIds = investigacoes.map((i) => i.anomaliaId);

  // Alguma dessas anomalias é desta entidade+métrica?
  const existe = await Anomalia.exists({
    _id: { $in: anomaliaIds },
    entidadeId,
    metrica,
  });

  return Boolean(existe);
}

export { JANELA_MINIMA_REPETICAO_HORAS };
