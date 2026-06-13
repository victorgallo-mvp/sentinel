/**
 * Modelo Investigacao — registra o processo completo do agente de IA
 * investigando uma anomalia: iterações, tools chamadas, raciocínio,
 * diagnóstico final e decisão de notificação.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const toolChamadaSchema = new Schema(
  {
    nome: { type: String, required: true },
    parametros: { type: Schema.Types.Mixed, default: {} },
    resultado: { type: Schema.Types.Mixed, default: {} },
    duracaoMs: { type: Number, default: 0 },
    iteracao: { type: Number, required: true },
  },
  { _id: false }
);

const diagnosticoSchema = new Schema(
  {
    causaProvavel: { type: String, default: null },
    confianca: { type: Number, default: null }, // 0-1
    severidade: {
      type: String,
      enum: ['info', 'atencao', 'urgente', 'critica'],
      default: null,
    },
    contextoRelevante: { type: [String], default: [] },
  },
  { _id: false }
);

const recomendacaoSchema = new Schema(
  {
    acao: { type: String, default: null },
    passosPraticos: { type: [String], default: [] },
    impactoEsperado: { type: String, default: null },
    urgenciaResposta: {
      type: String,
      enum: ['imediata', '24h', 'esta_semana'],
      default: null,
    },
  },
  { _id: false }
);

const investigacaoSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    anomaliaId: { type: Schema.Types.ObjectId, ref: 'Anomalia', required: true, index: true },

    inicioEm: { type: Date, default: Date.now },
    fimEm: { type: Date, default: null },
    duracaoSegundos: { type: Number, default: null },

    iteracoes: { type: Number, default: 0 },
    toolsChamadas: { type: [toolChamadaSchema], default: [] },

    raciocinio: { type: [String], default: [] },

    diagnostico: { type: diagnosticoSchema, default: () => ({}) },
    recomendacao: { type: recomendacaoSchema, default: () => ({}) },

    decidiuNotificar: { type: Boolean, default: false },
    motivoNaoNotificar: { type: String, default: null },

    custoTokensUsd: { type: Number, default: 0 },
    modeloUsado: { type: String, default: null },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Investigacao = mongoose.model('Investigacao', investigacaoSchema, 'investigacoes');
