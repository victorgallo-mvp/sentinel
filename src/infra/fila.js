/**
 * Filas de trabalho (BullMQ) — desacoplam detecção, triagem, investigação,
 * notificação e relatórios para que falhas em uma etapa não bloqueiem outras.
 */
import { Queue, Worker } from 'bullmq';
import { obterConexaoRedis } from './redis.js';
import { logger } from './logger.js';

/** Nomes das filas usadas pelo sistema. */
export const FILAS = {
  TRIAGEM: 'triagem',
  INVESTIGACAO: 'investigacao',
  NOTIFICAR: 'notificar',
  RELATORIO: 'relatorio',
};

const opcoesPadraoFila = {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // mantém histórico de 7 dias
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
};

const filasCriadas = new Map();

/** Retorna (criando se necessário) a fila BullMQ com o nome informado. */
export function obterFila(nome) {
  if (!filasCriadas.has(nome)) {
    const fila = new Queue(nome, {
      connection: obterConexaoRedis(),
      ...opcoesPadraoFila,
    });
    filasCriadas.set(nome, fila);
  }
  return filasCriadas.get(nome);
}

/**
 * Cria um worker para processar jobs de uma fila.
 * @param {string} nomeFila
 * @param {Function} processador - async (job) => resultado
 * @param {Object} opcoes - opções extras do BullMQ (ex: concurrency)
 */
export function criarWorker(nomeFila, processador, opcoes = {}) {
  const worker = new Worker(
    nomeFila,
    async (job) => {
      logger.info({ msg: 'Processando job', fila: nomeFila, jobId: job.id, dados: job.data });
      try {
        return await processador(job);
      } catch (erro) {
        logger.error({
          msg: 'Erro ao processar job',
          fila: nomeFila,
          jobId: job.id,
          erro: erro.message,
        });
        throw erro;
      }
    },
    {
      connection: obterConexaoRedis(),
      concurrency: opcoes.concurrency ?? 1,
      ...opcoes,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ msg: 'Job concluído', fila: nomeFila, jobId: job.id });
  });

  worker.on('failed', (job, erro) => {
    logger.error({ msg: 'Job falhou definitivamente', fila: nomeFila, jobId: job?.id, erro: erro.message });
  });

  return worker;
}

/** Adiciona um job a uma fila. */
export async function adicionarJob(nomeFila, nomeJob, dados, opcoes = {}) {
  const fila = obterFila(nomeFila);
  return fila.add(nomeJob, dados, opcoes);
}

/** Encerra todas as filas criadas. Usado em shutdown gracioso. */
export async function encerrarFilas() {
  for (const fila of filasCriadas.values()) {
    await fila.close();
  }
  filasCriadas.clear();
}
