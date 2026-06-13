/**
 * Modelo Notificacao — registra cada mensagem enviada ao usuário
 * (hoje via WhatsApp/Evolution API) referente a uma investigação.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const notificacaoSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    investigacaoId: { type: Schema.Types.ObjectId, ref: 'Investigacao', required: true, index: true },

    canal: { type: String, enum: ['whatsapp', 'email', 'telegram'], default: 'whatsapp' },
    destinatario: { type: String, required: true },
    conteudo: { type: String, required: true },
    idMensagemEnviada: { type: String, default: null },

    enviadaEm: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ['enviada', 'respondida', 'ignorada', 'erro'],
      default: 'enviada',
      index: true,
    },
    feedbackId: { type: Schema.Types.ObjectId, ref: 'Feedback', default: null },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Notificacao = mongoose.model('Notificacao', notificacaoSchema, 'notificacoes');
