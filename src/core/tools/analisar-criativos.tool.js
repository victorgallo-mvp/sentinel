/**
 * Tool: analisar_criativos
 * Lista os anúncios (criativos) rodando no adset da entidade investigada,
 * com performance individual (24h) — ajuda a identificar se a anomalia
 * vem de um criativo específico (fadiga, desaprovação, baixo CTR).
 *
 * Resolve o adset a partir do contexto:
 * - se a entidade investigada é um 'ad', usa o adset pai
 * - se é um 'adset', usa ela mesma
 * - se é uma 'campaign', lista criativos de todos os adsets da campanha
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { obterValorMaisRecente } from './_consultas.js';
import { arredondar } from '../../shared/utils.js';

export const tool = {
  name: 'analisar_criativos',
  description:
    'Lista os anúncios (criativos) do adset relacionado à entidade investigada, com métricas de performance individual (CTR, CPM, gasto, conversões, quality ranking) na janela de 24h.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const METRICAS_RETORNADAS = ['ctr', 'cpm', 'spend', 'conversions', 'purchase_roas'];

export async function executar(_parametros, contexto) {
  const { contaId, entidadeId } = contexto;

  const entidadeAtual = await Entidade.findById(entidadeId);
  if (!entidadeAtual) return { erro: 'Entidade não encontrada' };

  let adsetsIds = [];
  if (entidadeAtual.tipo === 'ad') {
    adsetsIds = [entidadeAtual.hierarquia.adsetId];
  } else if (entidadeAtual.tipo === 'adset') {
    adsetsIds = [entidadeAtual.metaId];
  } else {
    const adsetsDaCampanha = await Entidade.find({
      contaId,
      tipo: 'adset',
      'hierarquia.campanhaId': entidadeAtual.metaId,
    }).select('metaId');
    adsetsIds = adsetsDaCampanha.map((a) => a.metaId);
  }

  if (adsetsIds.length === 0) {
    return { criativos: [], observacao: 'Nenhum adset encontrado para a entidade investigada.' };
  }

  const ads = await Entidade.find({
    contaId,
    tipo: 'ad',
    'hierarquia.adsetId': { $in: adsetsIds },
    'configuracoes.monitorada': true,
  }).select('_id nome status hierarquia');

  const criativos = [];
  for (const ad of ads) {
    const metricas = {};
    for (const metrica of METRICAS_RETORNADAS) {
      const resultado = await obterValorMaisRecente(String(ad._id), metrica, 24);
      metricas[metrica] = resultado ? arredondar(resultado.valor, 4) : null;
    }

    criativos.push({
      nome: ad.nome,
      status: ad.status,
      adsetId: ad.hierarquia.adsetId,
      metricas24h: metricas,
    });
  }

  return {
    totalCriativos: criativos.length,
    criativos,
    observacao: 'Quality/engagement/conversion rankings não estão disponíveis na série histórica (são valores enum). Use obter_detalhes_entidade para um snapshot atual via Meta API se necessário.',
  };
}
