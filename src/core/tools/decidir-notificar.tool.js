/**
 * Tool finalizadora: decidir_notificar
 * Última tool que o agente deve chamar em uma investigação. Decide se a
 * anomalia merece notificação humana e, se sim, inclui a recomendação
 * acionável completa. Persiste a decisão direto no documento `Investigacao`.
 *
 * Nem toda anomalia merece notificação — só quando ação humana é
 * benéfica e oportuna.
 */
import { Investigacao } from '../../dominio/investigacao.modelo.js';

const recomendacaoSchema = {
  type: 'object',
  properties: {
    acao: { type: 'string', description: 'Recomendação principal em texto natural' },
    passosPraticos: { type: 'array', items: { type: 'string' }, description: 'Lista de passos práticos e acionáveis' },
    impactoEsperado: { type: 'string', description: 'Impacto esperado ao seguir a recomendação' },
    urgenciaResposta: { type: 'string', enum: ['imediata', '24h', 'esta_semana'], description: 'Urgência da resposta humana' },
  },
};

export const tool = {
  name: 'decidir_notificar',
  description:
    'Decide se a anomalia investigada merece notificação humana via WhatsApp. Se `notificar=true`, inclua a recomendação completa (acao, passosPraticos, impactoEsperado, urgenciaResposta). Se `notificar=false`, explique brevemente o motivo em `motivoNaoNotificar`. Esta é normalmente a ÚLTIMA tool chamada na investigação.',
  input_schema: {
    type: 'object',
    properties: {
      notificar: { type: 'boolean', description: 'true se vale a pena notificar um humano agora' },
      motivoNaoNotificar: { type: 'string', description: 'Obrigatório se notificar=false: por que não vale notificar agora' },
      recomendacao: {
        ...recomendacaoSchema,
        description: 'Obrigatório se notificar=true: recomendação acionável completa',
      },
    },
    required: ['notificar'],
  },
};

export async function executar(parametros, contexto) {
  const { investigacaoId } = contexto;
  const { notificar, motivoNaoNotificar, recomendacao } = parametros;

  const atualizacao = { decidiuNotificar: Boolean(notificar) };

  if (notificar) {
    atualizacao.recomendacao = {
      acao: recomendacao?.acao ?? null,
      passosPraticos: recomendacao?.passosPraticos ?? [],
      impactoEsperado: recomendacao?.impactoEsperado ?? null,
      urgenciaResposta: recomendacao?.urgenciaResposta ?? null,
    };
  } else {
    atualizacao.motivoNaoNotificar = motivoNaoNotificar ?? 'Não especificado pelo agente.';
  }

  await Investigacao.findByIdAndUpdate(investigacaoId, atualizacao);

  return { registrado: true, decidiuNotificar: Boolean(notificar) };
}
