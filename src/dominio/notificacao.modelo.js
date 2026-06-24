/**
 * Modelo Notificacao — registra cada mensagem enviada ao usuário.
 *
 * `tipo` distingue a origem:
 * - 'investigacao': gerada pelo agente após detectar anomalia (fluxo principal)
 * - 'alerta_orcamento': gerada pelo verificador de saldo, sem investigação associada
 * - 'resumo_diario': resumo diário automático
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const notificacaoSchema = new Schema(
  {
    contaId: { type: Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    tipo: {
      type: String,
      enum: ['investigacao', 'alerta_orcamento', 'alerta_performance', 'resumo_diario'],
      default: 'investigacao',
      index: true,
    },

    // Preenchido apenas para tipo='investigacao'
    investigacaoId: { type: Schema.Types.ObjectId, ref: 'Investigacao', default: null, index: true },
    // Preenchido para alertas diretos (orcamento, etc)
    entidadeId: { type: Schema.Types.ObjectId, ref: 'Entidade', default: null, index: true },

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
