/**
 * Modelo Relatorio — registro de relatórios semanais gerados para uma
 * conta, incluindo o conteúdo HTML e metadados de envio/atualização.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const relatorioSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },

    periodoInicio: { type: Date, required: true },
    periodoFim: { type: Date, required: true },

    resumoTexto: { type: String, default: null }, // gerado pelo agente analisador de portfólio
    conteudoHtml: { type: String, default: null },

    googleSheetsAtualizado: { type: Boolean, default: false },
    enviadoWhatsapp: { type: Boolean, default: false },

    custoTokensUsd: { type: Number, default: 0 },
    modeloUsado: { type: String, default: null },

    geradoEm: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

relatorioSchema.index({ contaId: 1, periodoInicio: -1 });

export const Relatorio = mongoose.model('Relatorio', relatorioSchema, 'relatorios');
