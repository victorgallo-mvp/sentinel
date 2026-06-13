/**
 * Tool: consultar_historico_metrica
 * Consulta valores históricos (janela 24h) de uma métrica específica da
 * entidade sob investigação, nos últimos N dias. Útil pra entender a
 * tendência da métrica antes da anomalia.
 */
import { obterHistoricoMetrica, estatisticasHistorico } from './_consultas.js';
import { arredondar } from '../../shared/utils.js';

export const tool = {
  name: 'consultar_historico_metrica',
  description:
    'Consulta valores históricos diários (janela de 24h) de uma métrica específica da entidade sob investigação, nos últimos N dias. Útil pra entender a tendência antes da anomalia.',
  input_schema: {
    type: 'object',
    properties: {
      metrica: { type: 'string', description: 'Nome da métrica (ex: cpm, ctr, purchase_roas)' },
      dias: { type: 'integer', description: 'Quantos dias de histórico consultar (1-90)', minimum: 1, maximum: 90 },
    },
    required: ['metrica', 'dias'],
  },
};

export async function executar(parametros, contexto) {
  const { metrica, dias } = parametros;
  const { entidadeId } = contexto;

  const pontos = await obterHistoricoMetrica(entidadeId, metrica, 24, dias);
  const estatisticas = estatisticasHistorico(pontos);

  return {
    metrica,
    dias,
    janela: '24h',
    pontos: pontos.map((p) => ({ valor: arredondar(p.valor, 4), data: p.data })),
    estatisticas: {
      media: arredondar(estatisticas.media, 4),
      desvioPadrao: arredondar(estatisticas.desvioPadrao, 4),
      minimo: arredondar(estatisticas.minimo, 4),
      maximo: arredondar(estatisticas.maximo, 4),
      quantidade: estatisticas.quantidade,
    },
  };
}
