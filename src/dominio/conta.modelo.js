/**
 * Modelo Conta — representa um cliente do sistema (uma Business Manager
 * do Meta + preferências de notificação e configuração).
 *
 * Mono-tenant operacional, multi-tenant estrutural: o sistema pode rodar
 * com uma única conta, mas o schema já suporta múltiplas.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const cargaSaldoSchema = new Schema(
  {
    valor: { type: Number, required: true },    // em reais
    dataHora: { type: Date, required: true },
    amountSpentNaCarga: { type: Number, default: 0 }, // amount_spent da conta no momento da carga
    contaAnuncioId: { type: String, required: true },
  },
  { _id: false }
);

// Snapshot do saldo pré-pago por conta de anúncio, atualizado pelo job horário
// de orçamento. Lido pelo dashboard sem precisar chamar a Meta API.
const saldoPrepagoSchema = new Schema(
  {
    contaAnuncioId: { type: String, required: true },
    saldoReais: { type: Number, default: null },   // saldo estimado (spend_cap - amount_spent)
    ritmoHora: { type: Number, default: null },     // R$/h estimado
    runwayHoras: { type: Number, default: null },   // horas de autonomia projetadas
    nivel: { type: String, default: null },         // 'ok'|'acabando'|'critico'|'zerado'|'bloqueado'
    motivoBloqueio: { type: String, default: null }, // rótulo do account_status quando nivel='bloqueado'
    // Último nível já notificado no WhatsApp. Anti-repetição: só alerta na MUDANÇA de
    // nível; zera quando o saldo volta a 'ok' (re-arma o alerta após uma recarga).
    nivelNotificado: { type: String, default: null },
    atualizadoEm: { type: Date },
  },
  { _id: false }
);

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
    whatsappJid:  { type: String, default: '' },
    whatsappJids: { type: [String], default: [] }, // destinatários adicionais
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
    prepago: { type: Boolean, default: false },
    limiarAlertaSaldoReais: { type: Number, default: 50 },
    metricasSelecionadas: { type: [String], default: [] }, // [] = usar padrão por objetivo
    // Alertas de entrega que o usuário marcou como "ciente" no dashboard.
    // chave = `${entidadeId}:${status}`; some quando o status muda (novo problema).
    alertasReconhecidos: {
      type: [
        new Schema(
          { chave: { type: String, required: true }, reconhecidoEm: { type: Date, default: Date.now } },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

// Perfil de negócio da conta (preenchido no onboarding): gerente responsável,
// investimento mensal planejado e objetivos declarados (até 3, ordenados).
const objetivoContaSchema = new Schema(
  {
    ordem: { type: Number, required: true }, // 1=principal, 2=secundário, 3=terciário
    chave: { type: String, required: true }, // conversao|mensagem|lead|trafego|alcance
  },
  { _id: false }
);

// Meta personalizada de performance: usuário define métrica + threshold + direção.
// Alerta dispara quando a condição é violada (ex: ROAS 7d caiu abaixo de 10x).
const metaPersonalizadaSchema = new Schema(
  {
    metrica:  { type: String, required: true },                              // chave do CATALOGO_METRICAS
    operador: { type: String, enum: ['abaixo_de', 'acima_de'], required: true },
    valor:    { type: Number, required: true },
    janela:   { type: String, enum: ['1d', '7d', '30d'], default: '7d' },
    ativo:    { type: Boolean, default: true },
  },
  { _id: false }
);

const perfilSchema = new Schema(
  {
    gerenteResponsavel:          { type: String, default: '' },
    investimentoMensalPlanejado: { type: Number, default: null }, // R$/mês
    objetivos:                   { type: [objetivoContaSchema], default: [] },
    metasPersonalizadas:         { type: [metaPersonalizadaSchema], default: [] },
  },
  { _id: false }
);

const contaSchema = new Schema(
  {
    identificador: { type: String, required: true, unique: true, index: true },
    nome: { type: String, required: true },

    perfil: { type: perfilSchema, default: () => ({}) },

    metaConfig: { type: metaConfigSchema, required: true },
    notificacao: { type: notificacaoSchema, default: () => ({}) },
    configuracoes: { type: configuracoesSchema, default: () => ({}) },
    cargas: { type: [cargaSaldoSchema], default: [] },
    saldoPrepago: { type: [saldoPrepagoSchema], default: [] },

    ativo: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' } }
);

export const Conta = mongoose.model('Conta', contaSchema, 'contas');
