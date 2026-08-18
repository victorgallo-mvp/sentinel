// Interceptador de rede do modo demonstração. Ativado só quando o token da URL
// é DEMO_TOKEN — nesse caso, TODA chamada a /dashboard/* é respondida aqui,
// com dados fictícios, sem nenhum request sair para o backend real. Fora do
// modo demo, `window.fetch` funciona exatamente como sempre funcionou.
import {
  montarRespostaDashboardData,
  gerarMiniResumoConta,
  contasAnuncioDisponiveis,
} from './gerarDados.js';
import { catalogoMetricasResposta, catalogoMetasResposta } from './catalogos.js';

export const DEMO_TOKEN = 'demo';

export function isDemoToken(token) {
  return token === DEMO_TOKEN;
}

// Estado mutável do modo demo — vive só na memória da aba, some ao recarregar.
// contaId -> { alertasReconhecidos: Set, metricasSelecionadas, metasPersonalizadas, perfil, contasAnuncioIds }
const overlayStore = new Map();
function overlayDe(contaId) {
  if (!overlayStore.has(contaId)) {
    overlayStore.set(contaId, { alertasReconhecidos: new Set() });
  }
  return overlayStore.get(contaId);
}

function jsonResponse(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function corpoJson(init) {
  if (!init?.body) return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

const RE_CONTA_SUB = /^\/dashboard\/contas\/([^/]+)\/([^/]+)$/;

async function tratarRequisicaoDemo(url, init) {
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  const params = url.searchParams;

  if (path === '/dashboard/data' && method === 'GET') {
    const isoHoje = new Date().toISOString().slice(0, 10);
    const dataInicio = params.get('dataInicio') ?? isoHoje;
    const dataFim = params.get('dataFim') ?? isoHoje;
    return jsonResponse(montarRespostaDashboardData(dataInicio, dataFim, overlayStore));
  }

  if (path === '/dashboard/metricas/catalogo' && method === 'GET') {
    return jsonResponse(catalogoMetricasResposta());
  }

  if (path === '/dashboard/metricas/catalogo-metas' && method === 'GET') {
    return jsonResponse(catalogoMetasResposta());
  }

  const m = path.match(RE_CONTA_SUB);
  if (m) {
    const [, contaId, recurso] = m;
    const overlay = overlayDe(contaId);

    if (recurso === 'mini-resumo' && method === 'GET') {
      const isoHoje = new Date().toISOString().slice(0, 10);
      const texto = gerarMiniResumoConta(contaId, isoHoje, isoHoje, overlayStore);
      return jsonResponse({ texto });
    }

    if (recurso === 'alertas' && method === 'PATCH') {
      const { chave, reconhecer = true } = await corpoJson(init);
      if (chave) {
        if (reconhecer) overlay.alertasReconhecidos.add(chave);
        else overlay.alertasReconhecidos.delete(chave);
      }
      return jsonResponse({ ok: true, chave, reconhecido: Boolean(reconhecer) });
    }

    if (recurso === 'metricas' && method === 'PATCH') {
      const { metricasSelecionadas } = await corpoJson(init);
      overlay.metricasSelecionadas = Array.isArray(metricasSelecionadas) ? metricasSelecionadas : [];
      return jsonResponse({ ok: true, metricasSelecionadas: overlay.metricasSelecionadas });
    }

    if (recurso === 'perfil' && method === 'PATCH') {
      const { gerenteResponsavel, investimentoMensalPlanejado, objetivos } = await corpoJson(init);
      overlay.perfil = {
        ...(overlay.perfil ?? {}),
        ...(gerenteResponsavel !== undefined ? { gerenteResponsavel: String(gerenteResponsavel ?? '').slice(0, 120) } : {}),
        ...(investimentoMensalPlanejado !== undefined ? { investimentoMensalPlanejado: Number(investimentoMensalPlanejado) > 0 ? Number(investimentoMensalPlanejado) : null } : {}),
        ...(objetivos !== undefined ? { objetivos } : {}),
      };
      return jsonResponse({ ok: true, perfil: overlay.perfil });
    }

    if (recurso === 'metas' && method === 'PATCH') {
      const { metasPersonalizadas } = await corpoJson(init);
      overlay.metasPersonalizadas = Array.isArray(metasPersonalizadas) ? metasPersonalizadas : [];
      return jsonResponse({ ok: true, metasPersonalizadas: overlay.metasPersonalizadas });
    }

    if (recurso === 'contas-anuncio' && method === 'GET') {
      const selecionadas = new Set(overlay.contasAnuncioIds ?? [contasAnuncioDisponiveis(contaId)[0]?.id]);
      const contas = contasAnuncioDisponiveis(contaId).map((c) => ({ ...c, selecionada: selecionadas.has(c.id) }));
      return jsonResponse({ contas });
    }

    if (recurso === 'contas-anuncio' && method === 'PATCH') {
      const { contasAnuncioIds } = await corpoJson(init);
      overlay.contasAnuncioIds = Array.isArray(contasAnuncioIds) ? contasAnuncioIds : [];
      return jsonResponse({ ok: true, contasAnuncioIds: overlay.contasAnuncioIds });
    }
  }

  if (path === '/dashboard/objetivos/catalogo' && method === 'GET') {
    return jsonResponse({
      catalogo: [
        { chave: 'conversao', nome: 'Conversões / Vendas' },
        { chave: 'mensagem', nome: 'Mensagens (WhatsApp)' },
        { chave: 'lead', nome: 'Leads / Formulário' },
        { chave: 'trafego', nome: 'Tráfego / Cliques' },
        { chave: 'alcance', nome: 'Alcance' },
      ],
    });
  }

  return jsonResponse({ erro: 'Rota de demonstração não implementada' }, 404);
}

let instalado = false;

/**
 * Substitui `window.fetch` por uma versão que intercepta chamadas a /dashboard/*
 * feitas com o token de demonstração e as responde localmente. Chamadas com
 * qualquer outro token (ou a outras rotas) seguem para o fetch original,
 * inclusive do mesmo token real do cliente continua batendo no backend de verdade.
 */
export function instalarInterceptadorDemo() {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    let url;
    try {
      const urlStr = typeof input === 'string' ? input : input?.url;
      url = new URL(urlStr, window.location.origin);
    } catch {
      return fetchOriginal(input, init);
    }

    if (!url.pathname.startsWith('/dashboard/') || url.searchParams.get('token') !== DEMO_TOKEN) {
      return fetchOriginal(input, init);
    }

    return tratarRequisicaoDemo(url, init);
  };
}
