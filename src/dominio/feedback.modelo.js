/**
 * Modelo Feedback — resposta do usuário a uma notificação, usada para
 * ajustar sensibilidade de detecção e medir utilidade dos alertas.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const feedbackSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    notificacaoId: { type: Schema.Types.ObjectId, ref: 'Notificacao', required: true, index: true },

    classificacao: {
      type: String,
      enum: ['util', 'ruido', 'parcial', 'comentario'],
      required: true,
    },
    comentarioLivre: { type: String, default: null },
    recebidoEm: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Feedback = mongoose.model('Feedback', feedbackSchema, 'feedbacks');
