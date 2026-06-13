/**
 * Tool finalizadora: registrar_diagnostico
 * O agente chama esta tool quando já formou um diagnóstico sobre a causa
 * provável da anomalia. Persiste o diagnóstico direto no documento
 * `Investigacao` em andamento (via `contexto.investigacaoId`).
 *
 * Não encerra o loop por si só — o agente normalmente segue para
 * `decidir_notificar` na mesma ou próxima iteração.
 */
import { Investigacao } from '../../dominio/investigacao.modelo.js';

export const tool = {
  name: 'registrar_diagnostico',
  description:
    'Registra o diagnóstico da investigação: causa provável da anomalia, nível de confiança, severidade e contexto relevante coletado. Chame quando tiver evidência suficiente para um diagnóstico.',
  input_schema: {
    type: 'object',
    properties: {
      causaProvavel: { type: 'string', description: 'Explicação objetiva da causa mais provável da anomalia' },
      confianca: { type: 'number', description: 'Confiança no diagnóstico, de 0 a 1', minimum: 0, maximum: 1 },
      severidade: {
        type: 'string',
        enum: ['info', 'atencao', 'urgente', 'critica'],
        description: 'Severidade do problema diagnosticado',
      },
      contextoRelevante: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de fatos/observações relevantes coletados durante a investigação',
      },
    },
    required: ['causaProvavel', 'confianca', 'severidade', 'contextoRelevante'],
  },
};

export async function executar(parametros, contexto) {
  const { investigacaoId } = contexto;
  const { causaProvavel, confianca, severidade, contextoRelevante } = parametros;

  await Investigacao.findByIdAndUpdate(investigacaoId, {
    diagnostico: { causaProvavel, confianca, severidade, contextoRelevante },
  });

  return { registrado: true };
}
