import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Gestor responsável por contas de cliente.
 *
 * Existe como coleção própria — e não como campo na conta — porque o mesmo
 * gestor cuida de várias contas: o número fica num lugar só, e trocá-lo
 * atualiza todas as contas dele de uma vez.
 */
const gestorSchema = new Schema(
  {
    nome:        { type: String, required: true, trim: true },
    whatsappJid: { type: String, default: '', trim: true },
    email:       { type: String, default: '', trim: true, lowercase: true },
    ativo:       { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Gestor = mongoose.model('Gestor', gestorSchema, 'gestores');
