/**
 * Modelo Conta — representa um cliente do sistema (uma Business Manager
 * do Meta + preferências de notificação e configuração).
 *
 * Mono-tenant operacional, multi-tenant estrutural: o sistema pode rodar
 * com uma única conta, mas o schema já suporta múltiplas.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const metaConfigSchema = new Schema(
  {
    bmId: { type: String, required: true },
    contasAnuncioIds: { type: [String], default: [] },
    systemUserToken: { type: String, required: true },
    appId: { type: String, required: true },
    appSecret: { type: String, required: true },
  },
  { _id: false }
);

const notificacaoSchema = new Schema(
  {
    canalPrimario: {
      type: String,
      enum: ['whatsapp', 'email', 'telegram'],
      default: 'whatsapp',
    },
    whatsappJid: { type: String, default: '' },
    horarioPermitidoInicio: { type: String, default: '08:00' },
    horarioPermitidoFim: { type: String, default: '22:00' },
    diasUteis: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
  },
  { _id: false }
);

const configuracoesSchema = new Schema(
  {
    intervaloColetaMinutos: { type: Number, default: 60 },
    sensibilidadePadrao: { type: Number, default: 2.5 },
    limiteCustoDiarioUsd: { type: Number, default: 3 },
    diasHistoricoBaseline: { type: Number, default: 21 },
    googleSheetsId: { type: String, default: '' },
  },
  { _id: false }
);

const contaSchema = new Schema(
  {
    identificador: { type: String, required: true, unique: true, index: true },
    nome: { type: String, required: true },

    metaConfig: { type: metaConfigSchema, required: true },
    notificacao: { type: notificacaoSchema, default: () => ({}) },
    configuracoes: { type: configuracoesSchema, default: () => ({}) },

    ativo: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Conta = mongoose.model('Conta', contaSchema, 'contas');
