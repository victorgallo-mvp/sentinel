/**
 * Tool: consultar_peers
 * Compara o baseline da entidade investigada com baselines de entidades
 * do mesmo tipo e objetivo em OUTRAS contas gerenciadas pelo sistema
 * (cross-tenant), de forma anonimizada — útil pra distinguir um problema
 * específico da conta de uma tendência de mercado/segmento mais ampla.
 *
 * Em instalações mono-conta, retorna `disponivel: false`.
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { obterBaseline } from './_consultas.js';
import { arredondar, calcularEstatisticas } from '../../shared/utils.js';

export const tool = {
  name: 'consultar_peers',
  description:
    'Compara o baseline da métrica investigada com o de entidades do mesmo tipo e objetivo em outras contas gerenciadas pelo sistema (anonimizado). Útil pra saber se um movimento é específico desta conta ou um padrão mais amplo do segmento.',
  input_schema: {
    type: 'object',
    properties: {
      metrica: { type: 'string', description: 'Nome da métrica a comparar (ex: cpm, ctr)' },
      janelaHoras: { type: 'integer', description: 'Janela: 1, 6 ou 24 (default 24)', enum: [1, 6, 24] },
    },
    required: ['metrica'],
  },
};

export async function executar(parametros, contexto) {
  const { metrica, janelaHoras = 24 } = parametros;
  const { contaId, entidadeId } = contexto;

  const entidadeAtual = await Entidade.findById(entidadeId);
  if (!entidadeAtual) return { erro: 'Entidade não encontrada' };

  const outrasContas = await Conta.find({ ativo: true, _id: { $ne: contaId } }).select('_id identificador');

  if (outrasContas.length === 0) {
    return {
      disponivel: false,
      observacao: 'Instalação mono-conta — não há peers de outras contas pra comparar ainda.',
    };
  }

  const baselineAtual = await obterBaseline(entidadeId, metrica, janelaHoras);

  const mediasPeers = [];
  for (const conta of outrasContas) {
    const peers = await Entidade.find({
      contaId: conta._id,
      tipo: entidadeAtual.tipo,
      objetivo: entidadeAtual.objetivo,
      'configuracoes.monitorada': true,
    }).select('_id');

    for (const peer of peers) {
      const baselinePeer = await obterBaseline(String(peer._id), metrica, janelaHoras);
      if (baselinePeer) mediasPeers.push(baselinePeer.media);
    }
  }

  if (mediasPeers.length === 0) {
    return { disponivel: false, observacao: 'Nenhum peer com baseline calculado para essa métrica/objetivo.' };
  }

  const estatisticasPeers = calcularEstatisticas(mediasPeers);

  return {
    disponivel: true,
    metrica,
    janelaHoras,
    objetivoComparado: entidadeAtual.objetivo,
    baselineEntidadeAtual: baselineAtual ? arredondar(baselineAtual.media, 4) : null,
    peers: {
      totalContasComparadas: outrasContas.length,
      totalEntidadesComBaseline: mediasPeers.length,
      mediaPeers: arredondar(estatisticasPeers.media, 4),
      desvioPadraoPeers: arredondar(estatisticasPeers.desvioPadrao, 4),
    },
  };
}
