/**
 * Conexão com PostgreSQL (Supabase) — séries temporais de métricas e baselines.
 * Usa um pool de conexões (`pg`) compartilhado por toda a aplicação.
 */
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const { Pool } = pg;

let pool = null;

/** Retorna o pool de conexões Postgres, criando-o na primeira chamada. */
export function obterPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.postgres.url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: config.ambiente === 'production' ? { rejectUnauthorized: false } : undefined,
    });

    pool.on('error', (erro) => {
      logger.error({ msg: 'Erro no pool Postgres', erro: erro.message });
    });
  }

  return pool;
}

/**
 * Executa uma query no Postgres.
 * @param {string} texto - SQL com placeholders $1, $2, ...
 * @param {Array} parametros - valores dos placeholders
 */
export async function query(texto, parametros = []) {
  const inicio = Date.now();
  const resultado = await obterPool().query(texto, parametros);
  const duracaoMs = Date.now() - inicio;

  if (duracaoMs > 1000) {
    logger.warn({ msg: 'Query Postgres lenta', duracaoMs, texto });
  }

  return resultado;
}

/** Encerra o pool de conexões. Usado em shutdown gracioso e testes. */
export async function encerrarPostgres() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info({ msg: 'Pool Postgres encerrado' });
  }
}
