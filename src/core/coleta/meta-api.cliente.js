/**
 * Wrapper de alto nível sobre o `facebook-nodejs-business-sdk`.
 * Centraliza todas as chamadas à Meta Marketing API: descoberta de
 * contas/campanhas/adsets/ads e coleta de insights (métricas).
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

/**
 * Campos solicitados em toda chamada de insights. `actions` e
 * `action_values` cobrem conversões/receita de qualquer evento
 * configurado (purchase, lead, etc) — o normalizador extrai o que precisa.
 */
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

/** Verifica o header de uso de rate limit da Meta e loga aviso se próximo do limite. */
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
    // header malformado/ausente — não é crítico, apenas não loga
  }
}

/** Converte um cursor do SDK em array simples de objetos planos. */
function paraArrayPlano(cursor) {
  return Array.from(cursor).map((item) => (typeof item.export_all_data === 'function' ? item.export_all_data() : item));
}

/**
 * Lista as contas de anúncio acessíveis por uma Business Manager —
 * tanto as que ela possui diretamente (`owned_ad_accounts`) quanto as
 * compartilhadas com ela como cliente (`client_ad_accounts`), já que é
 * comum a conta de anúncio pertencer a outra BM e ter sido apenas
 * compartilhada com a BM configurada.
 * @param {string} bmId - ID da BM (default: META_BM_ID)
 */
export async function listarContasAnuncio(bmId = config.meta.bmId) {
  obterApiMeta();
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
 * Lista campanhas de uma conta de anúncio.
 * @param {string} contaAnuncioId - formato `act_<id>`
 * @param {Object} opcoes - { apenasAtivas }
 */
export async function listarCampanhas(contaAnuncioId, { apenasAtivas = false } = {}) {
  obterApiMeta();

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

/** Lista adsets de uma campanha. */
export async function listarAdsets(campanhaId, { apenasAtivos = false } = {}) {
  obterApiMeta();

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

/** Lista ads de um adset. */
export async function listarAds(adsetId, { apenasAtivos = false } = {}) {
  obterApiMeta();

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
 * Obtém insights "crus" de uma entidade (campaign/adset/ad).
 * @param {'campaign'|'adset'|'ad'} tipo
 * @param {string} metaId
 * @param {Object} opcoes - { datePreset, timeIncrement, breakdowns, campos }
 */
export async function obterInsights(tipo, metaId, opcoes = {}) {
  obterApiMeta();

  const Classe = CLASSES_POR_TIPO[tipo];
  if (!Classe) throw new ErroMetaApi(`Tipo de entidade inválido para insights: ${tipo}`);

  const {
    datePreset = 'today',
    timeIncrement = 1,
    breakdowns = undefined,
    campos = CAMPOS_INSIGHTS_BASE,
    timeRange = undefined,
  } = opcoes;

  return comRetry(
    async () => {
      const objeto = new Classe(metaId);
      const params = { time_increment: timeIncrement };

      // `timeRange` ({since, until} no formato AAAA-MM-DD) tem prioridade
      // sobre `datePreset` — usado pelo backfill de histórico.
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
 * Obtém insights com breakdown horário do dia atual (timezone do anunciante).
 * Usado para compor as janelas de 1h e 6h.
 */
export async function obterInsightsHorarios(tipo, metaId) {
  return obterInsights(tipo, metaId, {
    datePreset: 'today',
    timeIncrement: 1,
    breakdowns: ['hourly_stats_aggregated_by_advertiser_time_zone'],
  });
}

/**
 * Lê configuração de um adset: orçamento, estratégia de lance e segmentação.
 * Usado pelas tools `verificar_orcamento` e `consultar_audiencia`.
 */
export async function obterConfiguracaoAdset(adsetMetaId) {
  obterApiMeta();

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
 * Lê configuração de orçamento de uma campanha (usado quando o adset
 * está em modo CBO — Campaign Budget Optimization — e não tem orçamento próprio).
 */
export async function obterConfiguracaoCampanha(campanhaMetaId) {
  obterApiMeta();

  return comRetry(async () => {
    const campanha = new Campaign(campanhaMetaId);
    const dados = await campanha.read(['id', 'name', 'status', 'daily_budget', 'lifetime_budget', 'budget_remaining']);
    return dados.export_all_data ? dados.export_all_data() : dados;
  });
}
