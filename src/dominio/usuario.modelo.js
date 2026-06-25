import mongoose from 'mongoose';

const { Schema } = mongoose;

const usuarioSchema = new Schema(
  {
    nome:       { type: String, required: true },
    token:      { type: String, required: true, unique: true, index: true },
    contaIds:   { type: [Schema.Types.ObjectId], ref: 'Conta', default: [] },
    superAdmin: { type: Boolean, default: false },
    ativo:      { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Usuario = mongoose.model('Usuario', usuarioSchema, 'usuarios');
