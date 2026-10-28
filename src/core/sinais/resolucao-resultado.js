/**
 * O que conta como "resultado" para uma entidade — e de onde veio a decisão.
 *
 * Três camadas, da mais confiável para a menos:
 *
 * 1. `meta` — o objetivo de otimização do CONJUNTO (`optimization_goal`). É o
 *    que o gestor disse à Meta ao criar o conjunto, e é por conjunto: uma
 *    campanha "de vendas" pode otimizar para conversas no WhatsApp sem pixel
 *    nenhum, e o objetivo da campanha esconderia isso. Anúncio herda do
 *    conjunto; campanha recebe o objetivo mais comum entre seus conjuntos.
 * 2. `onboarding` — o objetivo declarado no perfil da conta. Vale quando o
 *    conjunto não declara nada mapeável.
 * 3. `dados` — o evento de maior valor de negócio que de fato tem números
 *    nos últimos 30 dias. Vale quando as duas camadas acima calam.
 * 4. `proxy` — cliques no link. Último recurso, sempre marcado como tal.
 *
 * A origem fica gravada junto do sinal: "gastou sem resultado" só é uma
 * afirmação honesta se der para dizer com base em quê.
 */
import { metricaResultadoPorGoal } from '../../config/metricas.config.js';
import { resolverObjetivosConta } from '../../config/objetivos.config.js';

/** Ordem de valor de negócio para a camada `dados`. */
export const ORDEM_VALOR = [
  'conversions', 'leads', 'messaging_conversations_started',
  'landing_page_views', 'video_thruplay_watched_actions', 'inline_link_clicks',
];

export const ROTULO_SINGULAR = {
  conversions: 'compra',
  leads: 'lead',
  messaging_conversations_started: 'conversa',
  landing_page_views: 'visualização da página',
  video_thruplay_watched_actions: 'ThruPlay',
  inline_link_clicks: 'clique no link',
  clicks: 'clique',
};

/** Gênero gramatical do singular, para "nenhuma compra" / "nenhum lead". */
export const GENERO_RESULTADO = {
  conversions: 'f', leads: 'm', messaging_conversations_started: 'f', landing_page_views: 'f',
  video_thruplay_watched_actions: 'm', inline_link_clicks: 'm', clicks: 'm',
};

export const ROTULO_RESULTADO = {
  conversions: 'compras',
  leads: 'leads',
  messaging_conversations_started: 'conversas',
  landing_page_views: 'visualizações da página',
  video_thruplay_watched_actions: 'ThruPlays',
  inline_link_clicks: 'cliques no link',
  clicks: 'cliques',
  reach: 'pessoas alcançadas',
  impressions: 'impressões',
  video_p25_watched_actions: 'visualizações de vídeo',
};

/**
 * Objetivo de otimização por entidade: conjunto tem o próprio; anúncio herda
 * do conjunto; campanha recebe o mais frequente entre os conjuntos dela.
 * @param {Array} entidades - documentos Entidade (lean)
 * @returns {Map<string, string|null>} Entidade._id (string) → optimization_goal
 */
export function mapaObjetivoOtimizacao(entidades) {
  const goalPorAdset = new Map();
  const goalsPorCampanha = new Map();

  for (const e of entidades) {
    if (e.tipo !== 'adset') continue;
    const goal = e.optimizationGoal && e.optimizationGoal !== 'NONE' ? e.optimizationGoal : null;
    goalPorAdset.set(e.metaId, goal);
    if (goal && e.hierarquia?.campanhaId) {
      const lista = goalsPorCampanha.get(e.hierarquia.campanhaId) ?? [];
      lista.push(goal);
      goalsPorCampanha.set(e.hierarquia.campanhaId, lista);
    }
  }

  const maisComum = (lista) => {
    const n = {};
    for (const g of lista) n[g] = (n[g] ?? 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const saida = new Map();
  for (const e of entidades) {
    let goal = null;
    if (e.tipo === 'adset') goal = goalPorAdset.get(e.metaId) ?? null;
    else if (e.tipo === 'ad') goal = goalPorAdset.get(e.hierarquia?.adsetId) ?? null;
    else if (e.tipo === 'campaign') goal = maisComum(goalsPorCampanha.get(e.metaId) ?? []);
    saida.set(String(e._id), goal);
  }
  return saida;
}

/**
 * Resolve a métrica de resultado de uma entidade.
 *
 * @param {Object} opcoes
 * @param {string|null} opcoes.optimizationGoal - objetivo de otimização herdado/próprio
 * @param {Object} opcoes.perfil - perfil da conta (objetivos declarados)
 * @param {Set<string>} opcoes.metricasComDado - métricas com valor > 0 nos últimos 30 dias, nesta entidade
 * @returns {{ metrica: string, origem: 'meta'|'onboarding'|'dados'|'proxy', rotulo: string, rotuloSingular: string, genero: 'f'|'m' }}
 */
export function resolverResultado({ optimizationGoal, perfil, metricasComDado = new Set() }) {
  const monta = (metrica, origem) => ({
    metrica, origem,
    rotulo: ROTULO_RESULTADO[metrica] ?? metrica,
    rotuloSingular: ROTULO_SINGULAR[metrica] ?? ROTULO_RESULTADO[metrica] ?? metrica,
    genero: GENERO_RESULTADO[metrica] ?? 'm',
  });

  const porMeta = metricaResultadoPorGoal(optimizationGoal);
  if (porMeta) return monta(porMeta, 'meta');

  const declarado = resolverObjetivosConta(perfil)[0]?.metricaResultado;
  if (declarado) return monta(declarado, 'onboarding');

  const observado = ORDEM_VALOR.find((m) => metricasComDado.has(m));
  if (observado) return monta(observado, 'dados');

  return monta('inline_link_clicks', 'proxy');
}
