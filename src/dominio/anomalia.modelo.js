/**
 * Modelo Anomalia — registro de um desvio estatístico detectado pelo
 * pipeline determinístico. É a unidade de trabalho que entra na fila
 * de triagem e, possivelmente, de investigação pelo agente.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const triagemSchema = new Schema(
  {
    mereceInvestigacao: { type: Boolean, default: null },
    motivoBreve: { type: String, default: null },
    realizadaEm: { type: Date, default: null },
  },
  { _id: false }
);

const anomaliaSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    entidadeId: { type: Schema.Types.ObjectId, ref: 'Entidade', required: true, index: true },

    metrica: { type: String, required: true },
    valorAtual: { type: Number, required: true },
    baselineMedia: { type: Number, required: true },
    baselineDesvio: { type: Number, required: true },
    magnitudeDesvios: { type: Number, required: true },
    direcao: { type: String, enum: ['aumento', 'queda'], required: true },

    janelaMedicao: { type: String, required: true }, // "1h", "6h", "24h"

    detectadaEm: { type: Date, default: Date.now, index: true },

    statusProcessamento: {
      type: String,
      enum: ['detectada', 'triada', 'investigada', 'notificada', 'ignorada'],
      default: 'detectada',
      index: true,
    },

    triagem: { type: triagemSchema, default: () => ({}) },

    investigacaoId: { type: Schema.Types.ObjectId, ref: 'Investigacao', default: null },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

// Suporte à deduplicação: busca rápida por entidade+métrica+janela recente
anomaliaSchema.index({ entidadeId: 1, metrica: 1, janelaMedicao: 1, detectadaEm: -1 });

export const Anomalia = mongoose.model('Anomalia', anomaliaSchema, 'anomalias');
