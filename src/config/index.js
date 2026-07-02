/**
 * Configuração central da aplicação.
 * Carrega variáveis de ambiente (.env) e expõe um objeto único e validado.
 */
import 'dotenv/config';
import { z } from 'zod';

const esquemaEnv = z.object({
  // Bancos
  MONGO_URI: z.string().min(1, 'MONGO_URI é obrigatório'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatório'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY é obrigatório'),
  MODELO_TRIAGEM: z.string().default('claude-haiku-4-5'),
  MODELO_AGENTE: z.string().default('claude-sonnet-4-5'),
  // Liga/desliga todo o pipeline de IA (detecção→triagem→investigação→notificação
  // e relatório semanal). Desligado por padrão — o sistema roda só com os alertas
  // determinísticos. (z.enum em vez de z.coerce.boolean: "false" coage para true.)
  IA_INVESTIGACAO_ATIVA: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Resumo diário com IA: independente do pipeline de investigação acima. Quando
  // ligado, o resumo diário é redigido pela Claude (com fallback determinístico se
  // a chamada falhar). Modelo barato por padrão — é só resumir números já calculados.
  IA_RESUMO_DIARIO_ATIVA: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  MODELO_RESUMO_DIARIO: z.string().default('claude-haiku-4-5'),

  // Meta
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_SYSTEM_USER_TOKEN: z.string().optional().default(''),
  META_BM_ID: z.string().optional().default(''),
  META_API_VERSION: z.string().default('v21.0'),

  // Evolution API
  EVOLUTION_API_URL: z.string().optional().default(''),
  EVOLUTION_API_KEY: z.string().optional().default(''),
  EVOLUTION_INSTANCE_NAME: z.string().optional().default(''),

  // Conta atual
  CONTA_ID: z.string().default('victor-pessoal'),
  NOTIFICACAO_WHATSAPP_JID: z.string().optional().default(''),

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),

  // Limites
  LIMITE_CUSTO_DIARIO_USD: z.coerce.number().default(3.0),
  MAX_ITERACOES_AGENTE: z.coerce.number().int().default(6),

  // Servidor
  URL_BASE: z.string().optional().default(''),
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  ADMIN_TOKEN: z.string().optional().default(''),
  DASHBOARD_TOKEN: z.string().optional().default(''),
});

const resultado = esquemaEnv.safeParse(process.env);

if (!resultado.success) {
  console.error('Erro de configuração — variáveis de ambiente inválidas:');
  console.error(resultado.error.format());
  process.exit(1);
}

const env = resultado.data;

export const config = {
  ambiente: env.NODE_ENV,
  urlBase: env.URL_BASE,
  porta: env.PORT,
  logLevel: env.LOG_LEVEL,
  adminToken: env.ADMIN_TOKEN,
  dashboardToken: env.DASHBOARD_TOKEN,

  contaIdPadrao: env.CONTA_ID,

  mongo: {
    uri: env.MONGO_URI,
  },

  postgres: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    modeloTriagem: env.MODELO_TRIAGEM,
    modeloAgente: env.MODELO_AGENTE,
  },

  iaInvestigacaoAtiva: env.IA_INVESTIGACAO_ATIVA,
  iaResumoDiarioAtivo: env.IA_RESUMO_DIARIO_ATIVA,
  modeloResumoDiario: env.MODELO_RESUMO_DIARIO,

  meta: {
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    systemUserToken: env.META_SYSTEM_USER_TOKEN,
    bmId: env.META_BM_ID,
    apiVersion: env.META_API_VERSION,
  },

  evolution: {
    apiUrl: env.EVOLUTION_API_URL,
    apiKey: env.EVOLUTION_API_KEY,
    instanceName: env.EVOLUTION_INSTANCE_NAME,
    whatsappJidPadrao: env.NOTIFICACAO_WHATSAPP_JID,
  },

  googleSheets: {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
  },

  limites: {
    custoDiarioUsd: env.LIMITE_CUSTO_DIARIO_USD,
    maxIteracoesAgente: env.MAX_ITERACOES_AGENTE,
  },
};

export default config;
