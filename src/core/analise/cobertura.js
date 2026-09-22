/**
 * Cobertura de coleta: quantos dias de uma janela o sistema efetivamente mediu.
 *
 * Existe porque "dia sem linha" tem duas causas indistinguíveis olhando uma
 * conta só: a conta não entregou (pausada — zero é resultado real, a comparação
 * continua válida) ou o sistema não coletou (zero é ausência de medição, e
 * comparar é inventar). Como a coleta é global, basta perguntar se QUALQUER
 * entidade tem linha naquele dia.
 *
 * A parada de coleta de 03 a 08/09/2026 é o caso que motivou isto: sem a
 * guarda, o veredito de 7 dias de TODAS as contas exibiu ganhos fabricados.
 */
import { query } from '../../infra/postgres.js';

/** Cobertura mínima para que uma comparação entre períodos signifique algo. */
export const COBERTURA_MINIMA = 0.5;

// A saúde da coleta é global, então o resultado serve para todas as contas do
// mesmo request — e as janelas são as mesmas em todas elas.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

/** Dias corridos de uma janela. */
export function diasDaJanela(desde, ate) {
  return Math.max(1, Math.round((ate - desde) / 86400000));
}

/**
 * Quantos dias, dentro da janela, tiveram coleta do sistema.
 * @returns {Promise<number>}
 */
export async function diasComColeta(desde, ate) {
  // Em teste o cache atrapalha: os cenários usam as mesmas janelas de data.
  const semCache = process.env.NODE_ENV === 'test';
  const chave = `${desde.toISOString()}|${ate.toISOString()}`;
  const guardado = semCache ? null : cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) return guardado.dias;

  const r = await query(
    `SELECT count(DISTINCT date_trunc('day', coletada_em AT TIME ZONE 'America/Sao_Paulo')) AS dias
     FROM metricas_serie_temporal
     WHERE janela_horas = 24 AND coletada_em >= $1 AND coletada_em < $2`,
    [desde, ate]
  );
  const dias = Number(r.rows[0]?.dias ?? 0);
  if (!semCache) cache.set(chave, { dias, em: Date.now() });
  return dias;
}
