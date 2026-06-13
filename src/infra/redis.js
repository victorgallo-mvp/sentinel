/**
 * Conexão com Redis (Upstash) — usado pelo BullMQ para filas de trabalho.
 */
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let cliente = null;

/**
 * Retorna a conexão Redis compartilhada, criando-a na primeira chamada.
 * `maxRetriesPerRequest: null` é exigido pelo BullMQ para conexões usadas
 * em workers/queues.
 */
export function obterConexaoRedis() {
  if (!cliente) {
    cliente = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    cliente.on('error', (erro) => {
      logger.error({ msg: 'Erro na conexão Redis', erro: erro.message });
    });

    cliente.on('connect', () => {
      logger.info({ msg: 'Conectado ao Redis' });
    });
  }

  return cliente;
}

/** Encerra a conexão Redis. Usado em shutdown gracioso e testes. */
export async function encerrarRedis() {
  if (cliente) {
    await cliente.quit();
    cliente = null;
  }
}
