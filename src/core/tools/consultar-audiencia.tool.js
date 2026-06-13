/**
 * Tool: consultar_audiencia
 * Consulta a configuração de segmentação (targeting) do adset relacionado
 * à entidade investigada — idades, gêneros, localizações, interesses,
 * tamanho estimado — junto com alcance/frequência recentes.
 *
 * Resolve o adset a partir do contexto (mesma lógica de `analisar_criativos`).
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { obterConfiguracaoAdset } from '../coleta/meta-api.cliente.js';
import { obterValorMaisRecente } from './_consultas.js';
import { arredondar } from '../../shared/utils.js';
import { logger } from '../../infra/logger.js';

export const tool = {
  name: 'consultar_audiencia',
  description:
    'Consulta a segmentação (targeting) do adset relacionado à entidade investigada: idades, gêneros, localizações, interesses/audiências customizadas, além de alcance e frequência recentes.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export async function executar(_parametros, contexto) {
  const { contaId, entidadeId } = contexto;

  const entidadeAtual = await Entidade.findById(entidadeId);
  if (!entidadeAtual) return { erro: 'Entidade não encontrada' };

  let entidadeAdset = entidadeAtual;
  if (entidadeAtual.tipo === 'ad') {
    entidadeAdset = await Entidade.findOne({ contaId, tipo: 'adset', metaId: entidadeAtual.hierarquia.adsetId });
  } else if (entidadeAtual.tipo === 'campaign') {
    return { erro: 'Tool aplicável apenas a adsets ou ads (entidade investigada é uma campanha).' };
  }

  if (!entidadeAdset) return { erro: 'Adset relacionado não encontrado.' };

  const [reach, frequency] = await Promise.all([
    obterValorMaisRecente(String(entidadeAdset._id), 'reach', 24),
    obterValorMaisRecente(String(entidadeAdset._id), 'frequency', 24),
  ]);

  let targeting = null;
  let orcamento = null;
  try {
    const config = await obterConfiguracaoAdset(entidadeAdset.metaId);
    targeting = config.targeting ?? null;
    orcamento = {
      diario: config.daily_budget ?? null,
      total: config.lifetime_budget ?? null,
    };
  } catch (erro) {
    logger.warn({ msg: 'Falha ao buscar targeting via Meta API', adsetId: entidadeAdset.metaId, erro: erro.message });
  }

  return {
    adset: { nome: entidadeAdset.nome, status: entidadeAdset.status },
    alcance24h: reach ? arredondar(reach.valor, 0) : null,
    frequencia24h: frequency ? arredondar(frequency.valor, 2) : null,
    orcamento,
    targeting: targeting ?? { observacao: 'Não foi possível obter targeting via Meta API (verifique credenciais/permissões).' },
  };
}
