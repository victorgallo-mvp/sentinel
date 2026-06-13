/**
 * Conexão com MongoDB (Mongoose) — dados operacionais (contas, entidades,
 * anomalias, investigações, notificações, feedback, relatórios).
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let conectado = false;

/** Conecta ao MongoDB. Idempotente — chamadas subsequentes são no-op. */
export async function conectarMongo() {
  if (conectado) return mongoose.connection;

  mongoose.connection.on('error', (erro) => {
    logger.error({ msg: 'Erro na conexão MongoDB', erro: erro.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn({ msg: 'MongoDB desconectado' });
    conectado = false;
  });

  await mongoose.connect(config.mongo.uri, {
    serverSelectionTimeoutMS: 10000,
  });

  conectado = true;
  logger.info({ msg: 'Conectado ao MongoDB' });
  return mongoose.connection;
}

/** Encerra a conexão com o MongoDB. Usado em shutdown gracioso e testes. */
export async function desconectarMongo() {
  if (!conectado) return;
  await mongoose.disconnect();
  conectado = false;
  logger.info({ msg: 'Desconectado do MongoDB' });
}
