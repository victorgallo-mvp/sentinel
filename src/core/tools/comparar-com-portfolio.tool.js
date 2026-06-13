/**
 * Tool: comparar_com_portfolio
 * Compara o valor atual de uma métrica da entidade investigada com as
 * demais entidades do mesmo tipo (campaign/adset/ad) na mesma conta.
 * Ajuda a diferenciar um problema isolado de um problema sistêmico
 * (ex: CPM subiu em toda a conta vs só nesta campanha).
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { obterValorMaisRecente } from './_consultas.js';
import { arredondar, calcularEstatisticas } from '../../shared/utils.js';

export const tool = {
  name: 'comparar_com_portfolio',
  description:
    'Compara o valor atual de uma métrica da entidade investigada com as demais campanhas/adsets/ads da mesma conta (mesmo tipo). Ajuda a identificar se o problema é isolado ou afeta toda a conta.',
  input_schema: {
    type: 'object',
    properties: {
      metrica: { type: 'string', description: 'Nome da métrica a comparar (ex: cpm, ctr, frequency)' },
      janelaHoras: {
        type: 'integer',
        description: 'Janela de medição: 1, 6 ou 24 horas (default 24)',
        enum: [1, 6, 24],
      },
    },
    required: ['metrica'],
  },
};

export async function executar(parametros, contexto) {
  const { metrica, janelaHoras = 24 } = parametros;
  const { contaId, entidadeId } = contexto;

  const entidadeAtual = await Entidade.findById(entidadeId);
  if (!entidadeAtual) return { erro: 'Entidade não encontrada' };

  const peers = await Entidade.find({
    contaId,
    tipo: entidadeAtual.tipo,
    'configuracoes.monitorada': true,
    _id: { $ne: entidadeAtual._id },
  }).select('_id nome');

  const valoresPeers = [];
  for (const peer of peers) {
    const resultado = await obterValorMaisRecente(String(peer._id), metrica, janelaHoras);
    if (resultado) {
      valoresPeers.push({ nome: peer.nome, valor: resultado.valor });
    }
  }

  const valorAtualResultado = await obterValorMaisRecente(entidadeId, metrica, janelaHoras);
  const valorAtual = valorAtualResultado?.valor ?? null;

  const estatisticasPortfolio = calcularEstatisticas(valoresPeers.map((p) => p.valor));

  let posicaoRelativa = null;
  if (valorAtual !== null && valoresPeers.length > 0) {
    const todosValores = [valorAtual, ...valoresPeers.map((p) => p.valor)].sort((a, b) => a - b);
    const indice = todosValores.indexOf(valorAtual);
    posicaoRelativa = `${indice + 1} de ${todosValores.length} (do menor para o maior)`;
  }

  return {
    metrica,
    janelaHoras,
    entidadeAtual: { nome: entidadeAtual.nome, tipo: entidadeAtual.tipo, valor: valorAtual !== null ? arredondar(valorAtual, 4) : null },
    portfolio: {
      totalEntidadesComparadas: valoresPeers.length,
      media: arredondar(estatisticasPortfolio.media, 4),
      desvioPadrao: arredondar(estatisticasPortfolio.desvioPadrao, 4),
      minimo: arredondar(estatisticasPortfolio.minimo, 4),
      maximo: arredondar(estatisticasPortfolio.maximo, 4),
    },
    posicaoRelativa,
    peers: valoresPeers.map((p) => ({ nome: p.nome, valor: arredondar(p.valor, 4) })),
  };
}
