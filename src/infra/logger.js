/**
 * Logger estruturado (Winston) usado em toda a aplicação.
 * Em desenvolvimento, formata de forma legível no console.
 * Em produção, emite JSON estruturado (para agregadores de log).
 */
import winston from 'winston';
import { config } from '../config/index.js';

const { combine, timestamp, printf, colorize, json } = winston.format;

const formatoDesenvolvimento = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const resto = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const msg = typeof message === 'object' ? JSON.stringify(message) : message;
    return `${ts} [${level}] ${msg}${resto}`;
  })
);

const formatoProducao = combine(timestamp(), json());

export const logger = winston.createLogger({
  level: config.logLevel,
  format: config.ambiente === 'production' ? formatoProducao : formatoDesenvolvimento,
  transports: [new winston.transports.Console()],
});

export default logger;
