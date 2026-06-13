/**
 * Tool: buscar_eventos_meta
 * Verifica se há mudanças anunciadas pela Meta (algoritmo, política,
 * instabilidades) que possam explicar a anomalia.
 *
 * V1: retorna stub informativo — não há fonte de dados conectada.
 * V2: integrar com Brave Search (ou similar) buscando por termos como
 * "Meta Ads outage <data>" / "Meta Ads policy update <data>".
 */
export const tool = {
  name: 'buscar_eventos_meta',
  description:
    'Verifica se há eventos externos conhecidos (instabilidades, mudanças de algoritmo/política da Meta) que possam explicar a anomalia. Em V1 retorna apenas um stub informativo.',
  input_schema: {
    type: 'object',
    properties: {
      dias: { type: 'integer', description: 'Quantos dias atrás considerar na busca (default 2)' },
    },
    required: [],
  },
};

export async function executar(parametros, _contexto) {
  const dias = parametros.dias ?? 2;

  return {
    eventos: [],
    fonteDados: 'nenhuma (stub V1)',
    periodoConsiderado: `últimos ${dias} dias`,
    observacao:
      'Esta tool ainda não está conectada a uma fonte externa de eventos. ' +
      'Considere instabilidades amplamente divulgadas (ex: outages globais da Meta) ' +
      'apenas se você tiver conhecimento prévio sobre o período — não invente eventos. ' +
      'V2: integração com busca externa (Brave Search) para checar notícias recentes.',
  };
}
