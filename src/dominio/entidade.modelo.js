/**
 * Modelo Entidade — representa uma campanha, adset ou ad do Meta Ads
 * que está sendo monitorada pelo sistema.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const hierarquiaSchema = new Schema(
  {
    bmId: { type: String, required: true },
    contaAnuncioId: { type: String, required: true },
    campanhaId: { type: String, default: null },
    adsetId: { type: String, default: null },
  },
  { _id: false }
);

const silenciamentoSchema = new Schema(
  {
    metrica: { type: String, required: true },
    ate: { type: Date, required: true },
  },
  { _id: false }
);

const configuracoesEntidadeSchema = new Schema(
  {
    monitorada: { type: Boolean, default: true },
    sensibilidadeCustom: { type: Number, default: null },
    metricasIgnoradas: { type: [String], default: [] },
    // Silenciamentos temporários criados via feedback ("snooze 4h") —
    // expiram naturalmente; entradas vencidas são ignoradas na checagem.
    silenciamentos: { type: [silenciamentoSchema], default: [] },
  },
  { _id: false }
);

const entidadeSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },

    tipo: { type: String, enum: ['campaign', 'adset', 'ad'], required: true },
    metaId: { type: String, required: true, index: true },
    nome: { type: String, required: true },

    hierarquia: { type: hierarquiaSchema, required: true },

    objetivo: { type: String, default: null },
    status: { type: String, default: 'UNKNOWN' },

    configuracoes: { type: configuracoesEntidadeSchema, default: () => ({}) },

    ultimaSincronizacaoEm: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

entidadeSchema.index({ contaId: 1, metaId: 1, tipo: 1 }, { unique: true });
entidadeSchema.index({ contaId: 1, 'configuracoes.monitorada': 1 });

export const Entidade = mongoose.model('Entidade', entidadeSchema, 'entidades');
