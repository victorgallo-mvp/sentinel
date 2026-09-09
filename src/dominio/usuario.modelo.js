import mongoose from 'mongoose';

const { Schema } = mongoose;

const usuarioSchema = new Schema(
  {
    nome:       { type: String, required: true },
    email:      { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    senhaHash:  { type: String, required: true, select: false },
    contaIds:   { type: [Schema.Types.ObjectId], ref: 'Conta', default: [] },
    superAdmin: { type: Boolean, default: false },
    ativo:      { type: Boolean, default: true },
    ultimoLoginEm: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' },
    // Rede de segurança: o hash da senha nunca sai numa resposta HTTP, mesmo
    // quando o documento vem de `create()` (onde `select: false` não se aplica).
    toJSON: {
      transform(_doc, saida) {
        delete saida.senhaHash;
        return saida;
      },
    },
  }
);

export const Usuario = mongoose.model('Usuario', usuarioSchema, 'usuarios');
