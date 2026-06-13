/**
 * Tool: obter_detalhes_entidade
 * Retorna informações completas da entidade sob investigação: tipo,
 * objetivo, hierarquia (campanha/adset pai), status e configurações
 * de monitoramento.
 */
import { Entidade } from '../../dominio/entidade.modelo.js';

export const tool = {
  name: 'obter_detalhes_entidade',
  description:
    'Retorna informações completas da entidade sob investigação: nome, tipo, objetivo, status, hierarquia (campanha/adset pai) e configurações de monitoramento.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export async function executar(_parametros, contexto) {
  const { contaId, entidadeId } = contexto;

  const entidade = await Entidade.findById(entidadeId);
  if (!entidade) return { erro: 'Entidade não encontrada' };

  const resultado = {
    nome: entidade.nome,
    tipo: entidade.tipo,
    metaId: entidade.metaId,
    objetivo: entidade.objetivo,
    status: entidade.status,
    hierarquia: entidade.hierarquia,
    configuracoes: entidade.configuracoes,
    ultimaSincronizacaoEm: entidade.ultimaSincronizacaoEm,
  };

  if (entidade.tipo !== 'campaign' && entidade.hierarquia.campanhaId) {
    const campanha = await Entidade.findOne({ contaId, tipo: 'campaign', metaId: entidade.hierarquia.campanhaId }).select('nome status');
    resultado.campanhaPai = campanha ? { nome: campanha.nome, status: campanha.status } : null;
  }

  if (entidade.tipo === 'ad' && entidade.hierarquia.adsetId) {
    const adset = await Entidade.findOne({ contaId, tipo: 'adset', metaId: entidade.hierarquia.adsetId }).select('nome status');
    resultado.adsetPai = adset ? { nome: adset.nome, status: adset.status } : null;
  }

  return resultado;
}
