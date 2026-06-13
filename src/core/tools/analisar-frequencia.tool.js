/**
 * Tool: analisar_frequencia_audiencia
 * Investigação detalhada de saturação de audiência: histórico de
 * frequência e alcance (reach) nos últimos N dias, comparados com o
 * threshold de saturação (frequência > 4.0 indica possível fadiga de anúncio).
 */
import { obterHistoricoMetrica, estatisticasHistorico } from './_consultas.js';
import { obterMetadadosMetrica } from '../../config/metricas.config.js';
import { arredondar } from '../../shared/utils.js';

export const tool = {
  name: 'analisar_frequencia_audiencia',
  description:
    'Analisa histórico de frequência e alcance (reach) da entidade nos últimos N dias, indicando se há sinais de saturação de audiência (fadiga de anúncio).',
  input_schema: {
    type: 'object',
    properties: {
      dias: { type: 'integer', description: 'Quantos dias de histórico analisar (default 7)', minimum: 1, maximum: 30 },
    },
    required: [],
  },
};

export async function executar(parametros, contexto) {
  const dias = parametros.dias ?? 7;
  const { entidadeId } = contexto;

  const [historicoFrequencia, historicoAlcance] = await Promise.all([
    obterHistoricoMetrica(entidadeId, 'frequency', 24, dias),
    obterHistoricoMetrica(entidadeId, 'reach', 24, dias),
  ]);

  const statsFrequencia = estatisticasHistorico(historicoFrequencia);
  const statsAlcance = estatisticasHistorico(historicoAlcance);

  const thresholdSaturacao = obterMetadadosMetrica('frequency')?.thresholdConsideravel ?? 4.0;
  const frequenciaAtual = historicoFrequencia.at(-1)?.valor ?? null;
  const acimaDoThreshold = frequenciaAtual !== null && frequenciaAtual >= thresholdSaturacao;

  // Tendência simples: compara média da primeira metade vs segunda metade do período
  const meio = Math.floor(historicoFrequencia.length / 2);
  const tendenciaFrequencia =
    historicoFrequencia.length >= 4
      ? compararMedias(historicoFrequencia.slice(0, meio), historicoFrequencia.slice(meio))
      : 'dados insuficientes';

  return {
    dias,
    frequencia: {
      atual: frequenciaAtual !== null ? arredondar(frequenciaAtual, 2) : null,
      media: arredondar(statsFrequencia.media, 2),
      maximo: arredondar(statsFrequencia.maximo, 2),
      thresholdSaturacao,
      acimaDoThreshold,
      tendencia: tendenciaFrequencia,
    },
    alcance: {
      media: arredondar(statsAlcance.media, 0),
      minimo: arredondar(statsAlcance.minimo, 0),
      maximo: arredondar(statsAlcance.maximo, 0),
      ultimoValor: historicoAlcance.at(-1)?.valor ?? null,
    },
    diagnosticoRapido: acimaDoThreshold
      ? 'Frequência acima do threshold de saturação — audiência pode estar saturada.'
      : 'Frequência dentro do esperado.',
  };
}

function compararMedias(primeiraMetade, segundaMetade) {
  const mediaA = primeiraMetade.reduce((s, p) => s + p.valor, 0) / (primeiraMetade.length || 1);
  const mediaB = segundaMetade.reduce((s, p) => s + p.valor, 0) / (segundaMetade.length || 1);
  if (mediaB > mediaA * 1.1) return 'subindo';
  if (mediaB < mediaA * 0.9) return 'caindo';
  return 'estavel';
}
