/**
 * Tool: verificar_orcamento
 * Verifica orçamento configurado (adset ou campanha, se CBO), gasto nas
 * últimas 24h/6h/1h, ritmo de consumo e projeção até o fim do dia.
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { obterConfiguracaoAdset, obterConfiguracaoCampanha } from '../coleta/meta-api.cliente.js';
import { obterValorMaisRecente } from './_consultas.js';
import { arredondar } from '../../shared/utils.js';
import { logger } from '../../infra/logger.js';

export const tool = {
  name: 'verificar_orcamento',
  description:
    'Verifica o orçamento configurado (do adset ou, em CBO, da campanha), o gasto recente (1h/6h/24h) e projeta o consumo até o fim do dia. Útil pra anomalias de gasto/CPM.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export async function executar(_parametros, contexto) {
  const { contaId, entidadeId } = contexto;

  const [entidadeAtual, conta] = await Promise.all([
    Entidade.findById(entidadeId),
    Conta.findById(contaId).select('metaConfig.systemUserToken').lean(),
  ]);
  if (!entidadeAtual) return { erro: 'Entidade não encontrada' };
  const token = conta?.metaConfig?.systemUserToken || undefined;

  const [gasto1h, gasto6h, gasto24h] = await Promise.all([
    obterValorMaisRecente(entidadeId, 'spend', 1),
    obterValorMaisRecente(entidadeId, 'spend', 6),
    obterValorMaisRecente(entidadeId, 'spend', 24),
  ]);

  let orcamento = null;
  let origemOrcamento = null;

  try {
    if (entidadeAtual.tipo !== 'campaign') {
      const adsetMetaId = entidadeAtual.tipo === 'ad' ? entidadeAtual.hierarquia.adsetId : entidadeAtual.metaId;
      const configAdset = await obterConfiguracaoAdset(adsetMetaId, token);
      if (configAdset.daily_budget || configAdset.lifetime_budget) {
        orcamento = { diario: configAdset.daily_budget ?? null, total: configAdset.lifetime_budget ?? null };
        origemOrcamento = 'adset';
      }
    }

    if (!orcamento) {
      const campanhaMetaId = entidadeAtual.hierarquia.campanhaId ?? entidadeAtual.metaId;
      const configCampanha = await obterConfiguracaoCampanha(campanhaMetaId, token);
      orcamento = { diario: configCampanha.daily_budget ?? null, total: configCampanha.lifetime_budget ?? null };
      origemOrcamento = 'campaign (CBO)';
    }
  } catch (erro) {
    logger.warn({ msg: 'Falha ao buscar orçamento via Meta API', entidadeId, erro: erro.message });
  }

  // Valores de orçamento da Meta API vêm em centavos
  const orcamentoDiarioReais = orcamento?.diario ? Number(orcamento.diario) / 100 : null;

  const horaAtual = new Date().getHours();
  const horasTranscorridas = Math.max(horaAtual, 1);
  const projecaoFimDia = gasto24h ? arredondar((gasto24h.valor / horasTranscorridas) * 24, 2) : null;

  let percentualConsumido = null;
  let alertaRitmo = null;
  if (orcamentoDiarioReais && gasto24h) {
    percentualConsumido = arredondar((gasto24h.valor / orcamentoDiarioReais) * 100, 1);
    if (projecaoFimDia && projecaoFimDia > orcamentoDiarioReais * 1.1) {
      alertaRitmo = 'Ritmo de gasto projeta consumo acima do orçamento diário.';
    } else if (percentualConsumido < 50 && horaAtual > 18) {
      alertaRitmo = 'Gasto muito abaixo do orçamento diário considerando a hora do dia — possível subentrega.';
    }
  }

  return {
    orcamento: orcamento
      ? { diarioReais: orcamentoDiarioReais, totalCentavos: orcamento.total, origem: origemOrcamento }
      : { observacao: 'Não foi possível obter orçamento via Meta API.' },
    gasto: {
      ultimaHora: gasto1h ? arredondar(gasto1h.valor, 2) : null,
      ultimas6h: gasto6h ? arredondar(gasto6h.valor, 2) : null,
      ultimas24h: gasto24h ? arredondar(gasto24h.valor, 2) : null,
    },
    percentualConsumido,
    projecaoFimDia,
    alertaRitmo,
  };
}
