/**
 * Wrapper de alto nível sobre o `facebook-nodejs-business-sdk`.
 * Centraliza todas as chamadas à Meta Marketing API: descoberta de
 * contas/campanhas/adsets/ads e coleta de insights (métricas).
 *
 * Todas as funções aceitam um `token` opcional — quando fornecido, usa
 * esse token em vez do token global do .env. Isso permite suportar
 * múltiplas BMs com tokens distintos.
 *
 * Aplica retry com backoff exponencial em todas as chamadas externas
 * e registra avisos quando a resposta indica proximidade do rate limit.
 */
import bizSdk from 'facebook-nodejs-business-sdk';
import { obterApiMeta } from '../../infra/meta-cliente.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { comRetry } from '../../shared/utils.js';
import { ErroMetaApi } from '../../shared/erros.js';

const { AdAccount, Campaign, AdSet, Ad, Business } = bizSdk;

export const CAMPOS_INSIGHTS_BASE = [
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'unique_clicks',
  'ctr',
  'unique_ctr',
  'spend',
  'cpc',
  'cpm',
  'cpp',
  'actions',
  'action_values',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p100_watched_actions',
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',
];

const CLASSES_POR_TIPO = { campaign: Campaign, adset: AdSet, ad: Ad };

function verificarRateLimit(respostaCrua) {
  try {
    const headers = respostaCrua?.headers ?? {};
    const usoBruto = headers['x-business-use-case-usage'] || headers['x-ad-account-usage'];
    if (!usoBruto) return;

    const uso = JSON.parse(Array.isArray(usoBruto) ? usoBruto[0] : usoBruto);
    for (const entradas of Object.values(uso)) {
      for (const entrada of Array.isArray(entradas) ? entradas : [entradas]) {
        const percentual = entrada?.call_count ?? entrada?.acc_id_util_pct ?? 0;
        if (percentual >= 75) {
          logger.warn({ msg: 'Uso de rate limit Meta API próximo do limite', percentual, entrada });
        }
      }
    }
  } catch {
    // header malformado/ausente — não é crítico
  }
}

function paraArrayPlano(cursor) {
  return Array.from(cursor).map((item) => (typeof item.export_all_data === 'function' ? item.export_all_data() : item));
}

/**
 * @param {string} [bmId]
 * @param {string} [token]
 */
export async function listarContasAnuncio(bmId = config.meta.bmId, token) {
  obterApiMeta(token);
  if (!bmId) throw new ErroMetaApi('META_BM_ID não configurado');

  const campos = ['id', 'name', 'account_status', 'currency', 'timezone_name'];

  return comRetry(async () => {
    const business = new Business(bmId);

    const [proprias, clientes] = await Promise.all([
      business.getOwnedAdAccounts(campos),
      business.getClientAdAccounts(campos),
    ]);

    verificarRateLimit(proprias);
    verificarRateLimit(clientes);

    const contas = new Map();
    for (const c of [...paraArrayPlano(proprias), ...paraArrayPlano(clientes)]) {
      contas.set(c.id, {
        id: c.id,
        nome: c.name,
        status: c.account_status,
        moeda: c.currency,
        fusoHorario: c.timezone_name,
      });
    }

    return [...contas.values()];
  });
}

/**
 * @param {string} contaAnuncioId
 * @param {{ apenasAtivas?: boolean, token?: string }} [opcoes]
 */
export async function listarCampanhas(contaAnuncioId, { apenasAtivas = false, token } = {}) {
  obterApiMeta(token);

  return comRetry(async () => {
    const conta = new AdAccount(contaAnuncioId);
    const params = {};
    if (apenasAtivas) {
      params.filtering = [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }];
    }
    const cursor = await conta.getCampaigns(['id', 'name', 'objective', 'status', 'effective_status'], params);
    verificarRateLimit(cursor);
    return paraArrayPlano(cursor).map((c) => ({
      id: c.id,
      nome: c.name,
      objetivo: c.objective,
      status: c.status,
      statusEfetivo: c.effective_status,
    }));
  });
}

/**
 * @param {string} campanhaId
 * @param {{ apenasAtivos?: boolean, token?: string }} [opcoes]
 */
export async function listarAdsets(campanhaId, { apenasAtivos = false, token } = {}) {
  obterApiMeta(token);

  return comRetry(async () => {
    const campanha = new Campaign(campanhaId);
    const params = {};
    if (apenasAtivos) {
      params.filtering = [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }];
    }
    const cursor = await campanha.getAdSets(['id', 'name', 'status', 'effective_status', 'daily_budget', 'lifetime_budget'], params);
    verificarRateLimit(cursor);
    return paraArrayPlano(cursor).map((a) => ({
      id: a.id,
      nome: a.name,
      status: a.status,
      statusEfetivo: a.effective_status,
      orcamentoDiario: a.daily_budget,
      orcamentoTotal: a.lifetime_budget,
    }));
  });
}

/**
 * @param {string} adsetId
 * @param {{ apenasAtivos?: boolean, token?: string }} [opcoes]
 */
export async function listarAds(adsetId, { apenasAtivos = false, token } = {}) {
  obterApiMeta(token);

  return comRetry(async () => {
    const adset = new AdSet(adsetId);
    const params = {};
    if (apenasAtivos) {
      params.filtering = [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }];
    }
    const cursor = await adset.getAds(['id', 'name', 'status', 'effective_status', 'creative'], params);
    verificarRateLimit(cursor);
    return paraArrayPlano(cursor).map((a) => ({
      id: a.id,
      nome: a.name,
      status: a.status,
      statusEfetivo: a.effective_status,
      criativoId: a.creative?.id ?? null,
    }));
  });
}

/**
 * @param {'campaign'|'adset'|'ad'} tipo
 * @param {string} metaId
 * @param {{ datePreset?: string, timeIncrement?: number, breakdowns?: string[], campos?: string[], timeRange?: object, token?: string }} [opcoes]
 */
export async function obterInsights(tipo, metaId, opcoes = {}) {
  const Classe = CLASSES_POR_TIPO[tipo];
  if (!Classe) throw new ErroMetaApi(`Tipo de entidade inválido para insights: ${tipo}`);

  const {
    datePreset = 'today',
    timeIncrement = 1,
    breakdowns = undefined,
    campos = CAMPOS_INSIGHTS_BASE,
    timeRange = undefined,
    token,
  } = opcoes;

  obterApiMeta(token);

  return comRetry(
    async () => {
      const objeto = new Classe(metaId);
      const params = { time_increment: timeIncrement };

      if (timeRange) {
        params.time_range = timeRange;
      } else {
        params.date_preset = datePreset;
      }

      if (breakdowns) params.breakdowns = breakdowns;

      const cursor = await objeto.getInsights(campos, params);
      verificarRateLimit(cursor);
      return paraArrayPlano(cursor);
    },
    { tentativas: 4, esperaBaseMs: 1000, fatorBackoff: 2 }
  );
}

/**
 * @param {'campaign'|'adset'|'ad'} tipo
 * @param {string} metaId
 * @param {string} [token]
 */
export async function obterInsightsHorarios(tipo, metaId, token) {
  return obterInsights(tipo, metaId, {
    datePreset: 'today',
    timeIncrement: 1,
    breakdowns: ['hourly_stats_aggregated_by_advertiser_time_zone'],
    token,
  });
}

/**
 * @param {string} adsetMetaId
 * @param {string} [token]
 */
export async function obterConfiguracaoAdset(adsetMetaId, token) {
  obterApiMeta(token);

  return comRetry(async () => {
    const adset = new AdSet(adsetMetaId);
    const dados = await adset.read([
      'id',
      'name',
      'status',
      'daily_budget',
      'lifetime_budget',
      'budget_remaining',
      'bid_strategy',
      'optimization_goal',
      'targeting',
    ]);
    return dados.export_all_data ? dados.export_all_data() : dados;
  });
}

/**
 * Obtém status, saldo (pré-pago) e moeda de uma conta de anúncio.
 * `balance` só existe em contas pré-pagas — em pós-pagas vem null/0.
 * `account_status` indica se a conta está ativa (1), inadimplente (3/9), etc.
 *
 * @param {string} contaAnuncioId - formato `act_<id>`
 * @param {string} [token]
 */
export async function obterDetalhesContaAnuncio(contaAnuncioId, token) {
  obterApiMeta(token);

  return comRetry(async () => {
    const conta = new AdAccount(contaAnuncioId);
    const dados = await conta.read(['id', 'name', 'account_status', 'balance', 'currency', 'amount_spent']);
    return dados.export_all_data ? dados.export_all_data() : dados;
  });
}

/**
 * @param {string} campanhaMetaId
 * @param {string} [token]
 */
export async function obterConfiguracaoCampanha(campanhaMetaId, token) {
  obterApiMeta(token);

  return comRetry(async () => {
    const campanha = new Campaign(campanhaMetaId);
    const dados = await campanha.read(['id', 'name', 'status', 'daily_budget', 'lifetime_budget', 'budget_remaining']);
    return dados.export_all_data ? dados.export_all_data() : dados;
  });
}
