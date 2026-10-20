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
    // Usuários da Meta que são este gestor. O histórico de alterações vem
    // assinado pelo usuário do Facebook (id + nome), que raramente coincide
    // com o cadastro aqui — o vínculo é feito uma vez no painel de alterações.
    metaAtores:  { type: [{ id: { type: String, required: true }, nome: { type: String, default: '' } }], default: [] },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Gestor = mongoose.model('Gestor', gestorSchema, 'gestores');
